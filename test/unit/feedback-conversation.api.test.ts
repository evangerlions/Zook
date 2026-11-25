import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { FeedbackReplyWriteRolledBackError } from "../../src/infrastructure/database/feedback-conversation-store.ts";

const userPath = "/api/v1/ai_novel/feedback";
const adminPath = "/api/v1/admin/apps/ai_novel/feedback";
const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lH2m8QAAAABJRU5ErkJggg==";
const image = { fileName: "screen.png", mimeType: "image/png", contentBase64: png, sizeBytes: Buffer.from(png, "base64").length };
const submissionKey = (number: number) => `submission_key_${number}`;

async function fixture(t: TestContext) {
  const fileStorageRoot = mkdtempSync(join(tmpdir(), "feedback-conversation-test-"));
  t.after(() => rmSync(fileStorageRoot, { force: true, recursive: true }));
  const { app, services, database } = await createApplication({ fileStorageRoot, adminBasicAuth: { username: "admin", password: "AdminPass123!" } });
  const alice = await services.authService.login({ appId: "ai_novel", account: "alice@example.com", password: "Password1234" });
  const bob = await services.authService.login({ appId: "ai_novel", account: "bob@example.com", password: "Password1234" });
  const adminLogin = await app.handle({ method: "POST", path: "/api/v1/admin/auth/login", headers: {}, body: { username: "admin", password: "AdminPass123!" } });
  assert.equal(adminLogin.statusCode, 200);
  const user = { authorization: `Bearer ${alice.accessToken}` };
  const outsider = { authorization: `Bearer ${bob.accessToken}` };
  const admin = { cookie: adminLogin.headers?.["Set-Cookie"] };
  const initial = await app.handle({
    method: "POST", path: userPath, headers: user,
    body: { message: "This original feedback has enough words.", attachments: [image] },
  });
  assert.equal(initial.statusCode, 200);
  return { app, database, user, outsider, admin, fileStorageRoot, id: initial.body.data.id as string };
}

test("first feedback requires at least 20 characters after trimming", async t => {
  const { app, user } = await fixture(t);
  const submit = (message: string) =>
    app.handle({ method: "POST", path: userPath, headers: user, body: { message } });

  const tooShort = await submit("  short feedback text  ");
  assert.equal(tooShort.statusCode, 400);
  assert.equal(tooShort.body.code, "REQ_INVALID_BODY");
  assert.equal((await submit("  short feedback text.  ")).statusCode, 200);
});

test("feedback conversation keeps original image, private replies, unread and close semantics", async t => {
  const { app, database, user, outsider, admin, id } = await fixture(t);
  const own = `${userPath}/${id}`;
  const manage = `${adminPath}/${id}`;
  const initial = await app.handle({ method: "GET", path: own, headers: user });
  assert.deepEqual(initial.body.data.messages.map(item => item.sender), ["user"]);
  const original = initial.body.data.messages[0]!.attachments[0]!.id;
  const initialImage = await app.handle({ method: "GET", path: `${own}/attachments/${original}`, headers: user });
  assert.equal(initialImage.body.data.contentBase64, png);

  const staff = await app.handle({
    method: "POST", path: `${manage}/messages`, headers: admin,
    body: { message: "Could you try this?", attachments: [image], submissionKey: submissionKey(0), close: true },
  });
  assert.equal(staff.statusCode, 200);
  const conversation = await app.handle({ method: "GET", path: own, headers: user });
  assert.deepEqual(conversation.body.data.messages.map(item => item.sender), ["user", "support"]);
  assert.equal("status" in conversation.body.data, false);
  const newImage = conversation.body.data.messages[1]!.attachments[0]!.id;
  const ownerFetch = await app.handle({ method: "GET", path: `${own}/attachments/${newImage}`, headers: user });
  assert.equal(ownerFetch.body.data.contentBase64, png);
  for (const request of [
    { method: "GET", path: own },
    { method: "GET", path: `${own}/attachments/${newImage}` },
    { method: "POST", path: `${own}/read`, body: { messageId: staff.body.data.id } },
    { method: "POST", path: `${own}/messages`, body: { message: "Unauthorized", submissionKey: submissionKey(1) } },
  ]) {
    assert.equal((await app.handle({ ...request, headers: outsider })).statusCode, 404);
  }
  assert.equal((await app.handle({ method: "GET", path: manage, headers: user })).statusCode, 401);

  const beforeRead = await app.handle({ method: "GET", path: userPath, headers: user });
  assert.equal(beforeRead.body.data.hasUnread, true);
  assert.equal(beforeRead.body.data.items[0].unread, true);
  await app.handle({ method: "POST", path: `${own}/read`, headers: user, body: { messageId: staff.body.data.id } });
  assert.equal((await app.handle({ method: "GET", path: userPath, headers: user })).body.data.hasUnread, false);

  const submitImage = { method: "POST", path: `${own}/messages`, headers: user, body: { attachments: [image], submissionKey: submissionKey(2) } };
  const [first, second] = await Promise.all([app.handle(submitImage), app.handle(submitImage)]);
  assert.equal(first.statusCode, 200);
  assert.deepEqual(first.body.data, second.body.data);
  const conflict = await app.handle({ ...submitImage, body: { ...submitImage.body, message: "Modified after sending" } });
  assert.equal(conflict.statusCode, 400);
  const adminDetails = await app.handle({ method: "GET", path: manage, headers: admin });
  assert.deepEqual(adminDetails.body.data.messages.map(item => item.sender), ["user", "support", "user"]);
  assert.equal(adminDetails.body.data.messages[2].message, "");
  assert.equal((await app.handle({ method: "GET", path: adminPath, headers: admin })).body.data.items[0].status, "done");
  assert.deepEqual((await app.handle({ method: "GET", path: adminPath, headers: admin, query: { needsReply: "true" } })).body.data.items, []);
  await app.handle({ method: "PATCH", path: `${manage}/status`, headers: admin, body: { status: "doing" } });
  const pending = await app.handle({ method: "GET", path: adminPath, headers: admin, query: { needsReply: "true" } });
  assert.equal(pending.body.data.items[0].needsReply, true);
  assert.equal(database.auditLogs.filter(item => item.action === "feedback.reply.user").length, 1);
});

test("feedback reply limits concurrent sends and preserves the attachment-only flow", async t => {
  t.mock.timers.enable({ apis: ["Date"], now: Math.floor(Date.now() / 60_000) * 60_000 + 1_000 });
  const { app, user, id } = await fixture(t);
  const path = `${userPath}/${id}/messages`;
  const tooManyImages = await app.handle({
    method: "POST", path, headers: user, body: { attachments: Array(21).fill(image), submissionKey: submissionKey(0) },
  });
  assert.equal(tooManyImages.statusCode, 400);
  const images = await app.handle({
    method: "POST", path, headers: user, body: { attachments: Array(20).fill(image), submissionKey: submissionKey(1) },
  });
  assert.equal(images.statusCode, 200);
  const overflow = await app.handle({
    method: "POST", path, headers: user, body: { attachments: [image], submissionKey: submissionKey(2) },
  });
  assert.equal(overflow.statusCode, 429);
  const outcomes = await Promise.all(Array.from({ length: 13 }, (_, index) => app.handle({
    method: "POST", path, headers: user,
    body: { message: `Reply ${index}`, submissionKey: submissionKey(index + 3) },
  })));
  assert.equal(outcomes.filter(result => result.statusCode === 200).length, 9);
  assert.equal(outcomes.filter(result => result.statusCode === 429).length, 4);
});

test("feedback read cursor never hides a support reply that arrived after the one seen", async t => {
  const { app, user, admin, id } = await fixture(t);
  const initial = await app.handle({
    method: "POST", path: `${adminPath}/${id}/messages`, headers: admin,
    body: { message: "First support message", submissionKey: submissionKey(1) },
  });
  await app.handle({
    method: "POST", path: `${adminPath}/${id}/messages`, headers: admin,
    body: { message: "Second support message", submissionKey: submissionKey(2) },
  });
  const read = await app.handle({
    method: "POST", path: `${userPath}/${id}/read`, headers: user,
    body: { messageId: initial.body.data.id },
  });
  assert.equal(read.statusCode, 200);
  assert.equal((await app.handle({ method: "GET", path: userPath, headers: user })).body.data.hasUnread, true);
});

test("feedback replies reject oversized decoded dimensions despite claimed client dimensions", async t => {
  const { app, user, id } = await fixture(t);
  const oversized = Buffer.from(png, "base64");
  oversized.writeUInt32BE(8_000, 16);
  oversized.writeUInt32BE(8_000, 20);
  const invalid = await app.handle({
    method: "POST", path: `${userPath}/${id}/messages`, headers: user,
    body: {
      submissionKey: submissionKey(1),
      attachments: [{ ...image, contentBase64: oversized.toString("base64"), width: 1, height: 1 }],
    },
  });
  assert.equal(invalid.statusCode, 413);
  const detail = await app.handle({ method: "GET", path: `${userPath}/${id}`, headers: user });
  assert.equal(detail.body.data.messages.length, 1);
  assert.equal(detail.headers?.["Cache-Control"], "private, no-store");
});

test("feedback details return newest messages first by page, including the original on the last page", async t => {
  const { app, user, admin, id } = await fixture(t);
  for (let index = 1; index <= 51; index += 1) {
    const result = await app.handle({
      method: "POST", path: `${adminPath}/${id}/messages`, headers: admin,
      body: { message: `Reply ${index}`, submissionKey: submissionKey(index) },
    });
    assert.equal(result.statusCode, 200);
  }
  const latest = await app.handle({ method: "GET", path: `${userPath}/${id}`, headers: user });
  assert.equal(latest.body.data.messages.length, 50);
  assert.equal(latest.body.data.messages[0].message, "Reply 2");
  assert.equal(latest.body.data.messages[49].message, "Reply 51");
  const oldest = await app.handle({
    method: "GET", path: `${userPath}/${id}`, headers: user, query: { cursor: latest.body.data.nextCursor },
  });
  assert.deepEqual(oldest.body.data.messages.map(item => item.message), ["This original feedback has enough words.", "Reply 1"]);
  assert.equal(oldest.body.data.nextCursor, undefined);
});

test("feedback reply files are discarded on definite rollback and preserved after a lost commit acknowledgment", async t => {
  const { app, database, user, id, fileStorageRoot } = await fixture(t);
  const store = database.getFeedbackConversationStore();
  const append = store.append.bind(store);
  const request = { method: "POST", path: `${userPath}/${id}/messages`, headers: user };
  store.append = () => { throw new FeedbackReplyWriteRolledBackError(new Error("forced rollback")); };
  const rejected = await app.handle({
    ...request, body: { attachments: [image], submissionKey: submissionKey(1) },
  });
  assert.equal(rejected.statusCode, 500);
  const storedImages = () => readdirSync(fileStorageRoot, { recursive: true }).filter(file => String(file).endsWith(".png"));
  assert.equal(storedImages().length, 1);

  store.append = async (...args) => {
    await append(...args);
    throw new Error("lost acknowledgment");
  };
  const recovered = await app.handle({
    ...request, body: { attachments: [image], submissionKey: submissionKey(2) },
  });
  assert.equal(recovered.statusCode, 200);
  assert.equal(storedImages().length, 2);
});

test("feedback user may not set support closure fields", async t => {
  const { app, user, id } = await fixture(t);
  const result = await app.handle({
    method: "POST", path: `${userPath}/${id}/messages`, headers: user,
    body: { message: "I tried adding an admin field", submissionKey: submissionKey(1), close: true },
  });
  assert.equal(result.statusCode, 400);
});
