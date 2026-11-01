// BodyLog group invitation contract regressions. All requests use the in-memory
// application and synthetic accounts; no deployed server or real delivery is used.
import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" },
    status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO",
    createdAt: new Date().toISOString(),
  });
  seed.users!.push({ ...seed.users![0]!, id: "user_charlie", email: "charlie@example.com" });
  for (const userId of ["user_alice", "user_bob", "user_charlie"]) {
    seed.appUsers!.push({ id: `bodylog_${userId}`, appId: "bodylog", userId, status: "ACTIVE", joinedAt: new Date().toISOString() });
  }
  const runtime = await createApplication({ seed });
  const stores = resolveBodyLogStores(runtime.database);
  for (const feature of ["accountSocial", "friends", "competition", "challengeCreation"]) {
    await stores.flags.updateBodyLogFeatureFlag(feature, true);
  }
  const call = (userId: string, method: "GET" | "POST", path: string, body?: unknown, query?: Record<string, string>) => runtime.app.handle({
    method, path: `/api/v1/bodylog/${path}`, body, query,
    headers: { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, "bodylog")}` },
  });
  for (const userId of ["user_alice", "user_bob", "user_charlie"]) {
    assert.equal((await call(userId, "GET", "profile")).statusCode, 200);
  }
  const createGroup = async (maxMembers = 3) => {
    const response = await call("user_alice", "POST", "groups", { name: "Walk together", sharedHabitIds: ["habit-exercise"], maxMembers });
    assert.equal(response.statusCode, 200);
    return response.body.data.group;
  };
  const invite = async (groupId: string, userId = "user_bob") => {
    const response = await call("user_alice", "POST", `groups/${groupId}/invite`, { userId });
    assert.equal(response.statusCode, 200);
    return response.body.data;
  };
  return { call, createGroup, invite, store: stores.group };
}

test("group invite returns a bounded account-specific code, preview and redemption work", async () => {
  const { call, createGroup, invite } = await setup();
  const group = await createGroup();
  const receipt = await invite(group.id);
  assert.equal(receipt.invited, true);
  assert.match(receipt.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.ok(new Date(receipt.expiresAt).getTime() > Date.now());
  assert.ok(new Date(receipt.expiresAt).getTime() <= Date.now() + 7 * 86_400_000);
  const link = new URL(receipt.invitationUrl);
  assert.equal(link.pathname, `/g/${group.id}`);
  assert.ok(link.searchParams.get("token"));
  const preview = await call("user_bob", "GET", "groups/preview", undefined, { code: receipt.code });
  assert.equal(preview.statusCode, 200);
  assert.deepEqual(Object.keys(preview.body.data).sort(), ["id", "name", "currentMembers", "maxMembers", "expiresAt"].sort());
  assert.equal(preview.body.data.id, group.id);
  assert.equal(preview.body.data.currentMembers, 1);
  const joined = await call("user_bob", "POST", "groups/join-by-code", { code: receipt.code });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.body.data.id, group.id);
  assert.equal(joined.body.data.currentMembers, 2);
});

test("another account cannot preview or redeem the recipient's code", async () => {
  const { call, createGroup, invite, store } = await setup();
  const group = await createGroup();
  const { code } = await invite(group.id);
  for (const response of [
    await call("user_charlie", "GET", "groups/preview", undefined, { code }),
    await call("user_charlie", "POST", "groups/join-by-code", { code }),
  ]) assert.ok([403, 404].includes(response.statusCode));
  assert.equal(await store.findGroupMember(group.id, "user_charlie"), undefined);
  const rightful = await call("user_bob", "POST", "groups/join-by-code", { code });
  assert.equal(rightful.statusCode, 200);
});

test("expired invitation codes cannot preview or activate membership", async () => {
  const { call, createGroup, invite, store } = await setup();
  const group = await createGroup();
  const { code } = await invite(group.id);
  const member = (await store.findGroupMember(group.id, "user_bob"))!;
  await store.updateGroupMember({ ...member, joinedAt: new Date(Date.now() - 8 * 86_400_000).toISOString() });
  const preview = await call("user_bob", "GET", "groups/preview", undefined, { code });
  const joined = await call("user_bob", "POST", "groups/join-by-code", { code });
  assert.equal(preview.statusCode, 410);
  assert.equal(joined.statusCode, 410);
  assert.equal((await store.findGroupMember(group.id, "user_bob"))!.status, "pending");
});

test("renewing a pending invitation invalidates its old code", async () => {
  const { call, createGroup, invite } = await setup();
  const group = await createGroup();
  const original = await invite(group.id);
  const renewed = await invite(group.id);
  assert.notEqual(original.code, renewed.code);
  assert.ok([403, 404].includes((await call("user_bob", "POST", "groups/join-by-code", { code: original.code })).statusCode));
  assert.equal((await call("user_bob", "POST", "groups/join-by-code", { code: renewed.code })).statusCode, 200);
});

test("duplicate redemption is idempotent and records one joined activity", async () => {
  const { call, createGroup, invite, store } = await setup();
  const group = await createGroup();
  const { code } = await invite(group.id);
  const simultaneous = await Promise.all([
    call("user_bob", "POST", "groups/join-by-code", { code }),
    call("user_bob", "POST", "groups/join-by-code", { code }),
  ]);
  for (const response of simultaneous) assert.equal(response.statusCode, 200);
  assert.equal((await call("user_bob", "POST", "groups/join-by-code", { code })).statusCode, 200);
  const members = await store.listGroupMembers(group.id);
  assert.equal(members.filter(member => member.status === "active").length, 2);
  const activities = await store.listGroupActivities(group.id);
  assert.equal(activities.filter(activity => activity.type === "joined" && activity.actorUserId === "user_bob").length, 1);
});

test("concurrent redemptions cannot take the same last member slot", async () => {
  const { call, createGroup, invite, store } = await setup();
  const group = await createGroup(2);
  const bob = await invite(group.id, "user_bob");
  const charlie = await invite(group.id, "user_charlie");
  const responses = await Promise.all([
    call("user_bob", "POST", "groups/join-by-code", { code: bob.code }),
    call("user_charlie", "POST", "groups/join-by-code", { code: charlie.code }),
  ]);
  assert.equal(responses.filter(response => response.statusCode === 200).length, 1);
  assert.equal(responses.filter(response => response.statusCode === 403 && response.body.code === "GROUP_FULL").length, 1);
  assert.equal((await store.listGroupMembers(group.id)).filter(member => member.status === "active").length, 2);
});

test("removed members cannot reactivate an earlier invitation code", async () => {
  const { call, createGroup, invite, store } = await setup();
  const group = await createGroup();
  const { code } = await invite(group.id);
  assert.equal(typeof code, "string");
  const member = (await store.findGroupMember(group.id, "user_bob"))!;
  await store.updateGroupMember({ ...member, status: "removed" });
  const joined = await call("user_bob", "POST", "groups/join-by-code", { code });
  assert.ok([403, 404].includes(joined.statusCode));
  assert.equal((await store.findGroupMember(group.id, "user_bob"))!.status, "removed");
});
