// Group invitation failure paths must not activate membership or bypass the
// social capability gate. Synthetic in-memory application only.
import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) {
    seed.appUsers!.push({ id: `bodylog_${userId}`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: new Date().toISOString() });
  }
  const runtime = await createApplication({ seed });
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", true);
  const call = (userId: string, method: "GET" | "POST", route: string, body?: unknown, query?: Record<string, string>) => runtime.app.handle({
    method, path: `/api/v1/bodylog/${route}`, body, query,
    headers: { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, "bodylog")}` },
  });
  for (const user of ["user_alice", "user_bob"]) assert.equal((await call(user, "GET", "profile")).statusCode, 200);
  const created = await call("user_alice", "POST", "groups", { name: "Synthetic group", sharedHabitIds: ["habit-exercise"] });
  assert.equal(created.statusCode, 200);
  const groupId = created.body.data.group.id;
  const invited = await call("user_alice", "POST", `groups/${groupId}/invite`, { userId: "user_bob" });
  assert.equal(invited.statusCode, 200);
  assert.equal(typeof invited.body.data.code, "string");
  return { call, stores, groupId, code: invited.body.data.code };
}

test("a changed preview target cannot be silently joined", async () => {
  const { call, stores, groupId, code } = await setup();
  const preview = await call("user_bob", "GET", "groups/preview", undefined, { code });
  assert.equal(preview.statusCode, 200);
  const result = await call("user_bob", "POST", "groups/join-by-code", { code, expectedGroupId: "another-group" });
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, "GROUP_INVITE_CHANGED");
  assert.equal((await stores.group.findGroupMember(groupId, "user_bob"))!.status, "pending");
  assert.equal((await stores.group.listGroupActivities(groupId)).filter(item => item.type === "joined").length, 0);
});

test("malformed codes produce a validation error without changing membership", async () => {
  const { call, stores, groupId } = await setup();
  for (const code of ["", "A", "ABC1234", "!!!!!!", "IIIIII"]) {
    assert.equal((await call("user_bob", "GET", "groups/preview", undefined, { code })).statusCode, 400);
    assert.equal((await call("user_bob", "POST", "groups/join-by-code", { code })).statusCode, 400);
  }
  assert.equal((await stores.group.findGroupMember(groupId, "user_bob"))!.status, "pending");
});

test("closed accountSocial capability prevents preview and redemption", async () => {
  const { call, stores, groupId, code } = await setup();
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", false);
  const preview = await call("user_bob", "GET", "groups/preview", undefined, { code });
  const joined = await call("user_bob", "POST", "groups/join-by-code", { code, expectedGroupId: groupId });
  assert.equal(preview.statusCode, 404);
  assert.equal(joined.statusCode, 404);
  assert.equal((await stores.group.findGroupMember(groupId, "user_bob"))!.status, "pending");
});

test("reinviting a former leader cannot restore a second leader role", async () => {
  const { call, stores, groupId, code } = await setup();
  assert.equal((await call("user_bob", "POST", "groups/join-by-code", { code })).statusCode, 200);
  assert.equal((await call("user_alice", "POST", `groups/${groupId}/leave`)).statusCode, 200);
  const reinvited = await call("user_bob", "POST", `groups/${groupId}/invite`, { userId: "user_alice" });
  assert.equal(reinvited.statusCode, 200);
  assert.equal((await call("user_alice", "POST", "groups/join-by-code", { code: reinvited.body.data.code })).statusCode, 200);
  const members = await stores.group.listGroupMembers(groupId);
  assert.equal(members.find(member => member.userId === "user_alice")!.role, "member");
  assert.equal(members.filter(member => member.status === "active" && member.role === "leader").length, 1);
});
