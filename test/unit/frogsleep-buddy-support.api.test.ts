import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { BuddySupportCommand } from "../../src/modules/frogsleep/buddy-support/buddy-support-command.ts";
import { enableFrogSleepBuddyCapabilities } from "../helpers/enable-frogsleep-buddy-capabilities.ts";
enableFrogSleepBuddyCapabilities();
process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "true";

async function fixture() {
  const app = await createApplication({ frogsleepEnabled: true, queueBackend: "memory", databaseFactory: seed => new InMemoryDatabase(seed) });
  const login = async (account: string) => {
    const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
      headers: {}, body: { account, password: "Password1234" }, requestId: "support_login" } as never);
    return { authorization: `Bearer ${response.body.data.access_token}` };
  };
  const alice = await login("alice@example.com"), bob = await login("bob@example.com");
  const now = new Date().toISOString();
  await app.database.insertFrogSleepEntity({ id: "support_api_sleep", appId: "frogsleep", kind: "sleep_relationship",
    ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
  return { app, alice, bob };
}

test("support center exposes real notes and flowers without notification or implicit consent", async () => {
  const { app, alice, bob } = await fixture();
  const call = (method: string, suffix: string, headers = alice, body?: unknown, query?: unknown) => app.app.handle({
    method, path: `/api/v1/frogsleep/buddy-support${suffix}`, headers, body, query, requestId: "support_api" } as never);
  const before = await call("GET", "/center");
  assert.equal(before.statusCode, 200);
  assert.equal(before.body.data.partners[0].relationships[0].enabled, false);
  assert.equal(await app.database.getBuddySupportRepository().isEnrolled("frogsleep", "support_api_sleep"), false);
  await new BuddySupportCommand(app.database).enroll("user_alice", "support_api_sleep");
  const enabled = await call("PUT", "/permissions/support_api_sleep", bob, { enabled: true, expected_revision: 0, operation_id: "enable" });
  assert.equal(enabled.statusCode, 200);
  const sent = await call("POST", "/notes", alice, { relationship_id: "support_api_sleep", operation_id: "send",
    template_key: "sleep_goodnight", flower: true });
  assert.equal(sent.statusCode, 200, JSON.stringify(sent.body));
  const center = await call("GET", "/center", bob);
  assert.equal(center.body.data.partners[0].latest_received_note.id, sent.body.data.note.id);
  assert.equal(center.body.data.partners[0].latest_received_note.flower, true);
  const protectedCenter = await call("GET", "/center", bob, undefined, { include_content: "false" });
  assert.equal(protectedCenter.body.data.partners[0].latest_received_note, null);
  const hidden = await call("GET", "/center", bob, undefined, { include_content: "invalid" });
  assert.equal(hidden.statusCode, 400);
  const history = await call("GET", "/notes", bob, undefined, { limit: "1" });
  assert.equal(history.body.data.notes.length, 1);
  assert.equal(history.headers?.["Cache-Control"], "no-store");
  await call("POST", `/notes/${sent.body.data.note.id}/acknowledgement`, bob, { operation_id: "ack" });
  await call("POST", `/notes/${sent.body.data.note.id}/acknowledgement`, bob, { operation_id: "ack-again" });
  await call("POST", "/notes", alice, { relationship_id: "support_api_sleep", operation_id: "send", template_key: "sleep_goodnight", flower: true });
  const events = (await app.database.listAnalyticsEvents("frogsleep")).filter(x => x.eventName.startsWith("frogsleep_support_"));
  assert.equal(events.length, 3);
  assert.deepEqual(events.find(x => x.eventName === "frogsleep_support_sent")?.metadata, { domain: "sleep", kind: "template_flower" });
  assert.equal(events.filter(x => x.eventName === "frogsleep_support_acknowledged").length, 1);
  assert.equal((app.database as InMemoryDatabase).frogSleepBuddyNotificationOutbox.length, 0);
});

test("support flag off is a clean fallback and private input is rejected", async () => {
  const { app, alice } = await fixture();
  const call = (method: string, suffix: string, body?: unknown) => app.app.handle({ method,
    path: `/api/v1/frogsleep/buddy-support${suffix}`, headers: alice, body, requestId: "support_flag" } as never);
  const invalid = await call("POST", "/notes", { relationship_id: "support_api_sleep", operation_id: "raw", flower: true, custom_text: "hello" });
  assert.equal(invalid.statusCode, 400);
  process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "false";
  try {
    const off = await call("GET", "/center");
    assert.deepEqual(off.body.data.partners, []);
    assert.equal(off.body.data.enabled, false);
    assert.equal((await call("POST", "/notes", { flower: true })).statusCode, 404);
  } finally { process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "true"; }
});


test("enrolled legacy encouragement stays blocked even when the new capability is rolled back", async () => {
  const { app, alice } = await fixture();
  await new BuddySupportCommand(app.database).enroll("user_alice", "support_api_sleep");
  process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "false";
  try {
    const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/interactions",
      headers: alice, body: { relationship_id: "support_api_sleep", type: "encouragement", idempotency_key: "legacy" }, requestId: "legacy_support" } as never);
    assert.equal(response.statusCode, 409);
    assert.equal(response.body.code, "BUDDY_SUPPORT_UPDATE_REQUIRED");
    const now = new Date().toISOString();
    await app.database.insertFrogSleepEntity({ id: "support_api_focus", appId: "frogsleep", kind: "focus_relationship",
      ownerUserId: "user_alice", partnerUserId: "user_bob", status: "accepted", payload: {}, createdAt: now, updatedAt: now });
    await new BuddySupportCommand(app.database).enroll("user_alice", "support_api_focus");
    const legacyFocus = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/messages", headers: alice,
      body: { receiver_user_id: "user_bob", template_key: "keep_going" }, requestId: "legacy_focus" } as never);
    assert.equal(legacyFocus.statusCode, 409);
    assert.equal(legacyFocus.body.code, "BUDDY_SUPPORT_UPDATE_REQUIRED");
    assert.equal((app.database as InMemoryDatabase).frogSleepBuddyNotificationOutbox.length, 0);
  } finally { process.env.FROGSLEEP_BUDDY_SUPPORT_ENABLED = "true"; }
});


test("API enforces domain, membership and application boundaries", async () => {
  const { app, alice, bob } = await fixture();
  const call = (method: string, suffix: string, headers = alice, body?: unknown) => app.app.handle({ method,
    path: `/api/v1/frogsleep/buddy-support${suffix}`, headers, body, requestId: "support_security" } as never);
  await new BuddySupportCommand(app.database).enroll("user_alice", "support_api_sleep");
  await call("PUT", "/permissions/support_api_sleep", bob, { enabled: true, expected_revision: 0, operation_id: "enable" });
  const body = { relationship_id: "support_api_sleep", operation_id: "test", template_key: "sleep_goodnight", flower: true };
  assert.equal((await call("POST", "/notes", alice, { ...body, template_key: "unknown" })).statusCode, 400);
  assert.equal((await call("POST", "/notes", alice, { ...body, template_key: "focus_restart" })).statusCode, 400);
  assert.equal((await call("POST", "/notes", bob, body)).statusCode, 404);
  assert.equal((await call("POST", "/notes", alice, { ...body, relationship_id: "unrelated" })).statusCode, 404);
  const generic = await app.app.handle({ method: "POST", path: "/api/v1/auth/login", headers: {},
    body: { appId: "app_a", clientType: "app", account: "alice@example.com", password: "Password1234" }, requestId: "other_app" } as never);
  assert.equal(generic.statusCode, 200, JSON.stringify(generic.body));
  assert.equal((await call("GET", "/center", { authorization: `Bearer ${generic.body.data.accessToken}` })).statusCode, 403);
  await assert.rejects(app.services.analyticsService.recordBatch({ appId: "frogsleep", userId: "user_alice", events: [{
    platform: "ios", sessionId: "spoof", pageKey: "buddy-support", eventName: "frogsleep_support_sent", occurredAt: new Date().toISOString(),
  }] }), /Unsupported event/);
});

test("account deletion removes note, consent and durable operations from both sides", async () => {
  const { app, alice, bob } = await fixture();
  const command = new BuddySupportCommand(app.database);
  await command.enroll("user_alice", "support_api_sleep");
  await command.setReceiving("user_bob", "support_api_sleep", { enabled: true, expected_revision: 0, operation_id: "delete_enable" });
  const { note } = await command.send("user_alice", { relationship_id: "support_api_sleep", operation_id: "delete_send", flower: true });
  const deleted = await app.app.handle({ method: "DELETE", path: "/api/v1/frogsleep/me/account", headers: alice, requestId: "support_delete" } as never);
  assert.equal(deleted.statusCode, 200);
  const store = app.database.getBuddySupportRepository();
  assert.equal(await store.note("frogsleep", note.id), undefined);
  assert.equal(await store.permission("frogsleep", "support_api_sleep", "user_bob"), undefined);
  assert.equal(await store.operation("frogsleep", "user_alice", "delete_send"), undefined);
  const history = await app.app.handle({ method: "GET", path: "/api/v1/frogsleep/buddy-support/notes", headers: bob, requestId: "after_delete" } as never);
  assert.equal(history.statusCode, 200); assert.deepEqual(history.body.data.notes, []);
});
