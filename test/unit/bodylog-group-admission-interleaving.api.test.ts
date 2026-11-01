// Deterministic stale-read regressions: one redemption captures a pending member,
// then another redemption completes before the first request checks capacity.
// All application data and notifications are synthetic/in-memory.
import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";
import { BodyLogGroupService } from "../../src/modules/bodylog/bodylog-group.service.ts";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

async function within<T>(promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timeout = setTimeout(() => reject(new Error("Expected pending-member read was not reached.")), 3000);
    })]);
  } finally { if (timeout) clearTimeout(timeout); }
}

async function setup(maxMembers: number, hasExistingGroup = false) {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) {
    seed.appUsers!.push({ id: `bodylog_${userId}`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: new Date().toISOString() });
  }
  const runtime = await createApplication({ seed });
  const store = resolveBodyLogStores(runtime.database).group;
  await resolveBodyLogStores(runtime.database).flags.updateBodyLogFeatureFlag("accountSocial", true);
  const call = (userId: string, method: "GET" | "POST", route: string, body?: unknown) => runtime.app.handle({
    method, path: `/api/v1/bodylog/${route}`, body,
    headers: { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, "bodylog")}` },
  });
  for (const userId of ["user_alice", "user_bob"]) assert.equal((await call(userId, "GET", "profile")).statusCode, 200);
  if (hasExistingGroup) {
    assert.equal((await call("user_bob", "POST", "groups", {
      name: "Bob's existing group", sharedHabitIds: ["habit-exercise"], maxMembers: 3,
    })).statusCode, 200);
  }
  const created = await call("user_alice", "POST", "groups", {
    name: "Shared group", sharedHabitIds: ["habit-exercise"], maxMembers,
  });
  assert.equal(created.statusCode, 200);
  const groupId: string = created.body.data.group.id;
  const invited = await call("user_alice", "POST", `groups/${groupId}/invite`, { userId: "user_bob" });
  assert.equal(invited.statusCode, 200);
  assert.equal(typeof invited.body.data.code, "string");
  // Direct service calls are essential here: the in-memory HTTP application
  // serializes entire requests via withExclusiveSession, unlike the domain store.
  const service = new BodyLogGroupService(store, runtime.database);
  return { store, groupId, code: invited.body.data.code, service };
}

async function assertRepeatedJoinSurvivesStalePrecheck(maxMembers: number, hasExistingGroup: boolean) {
  const { store, groupId, code, service } = await setup(maxMembers, hasExistingGroup);
  const readPending = deferred();
  const resume = deferred();
  const original = store.findGroupMember.bind(store);
  let interceptNextPendingRead = true;
  store.findGroupMember = async (id, userId) => {
    const captured = await original(id, userId);
    if (interceptNextPendingRead && id === groupId && userId === "user_bob" && captured?.status === "pending") {
      interceptNextPendingRead = false;
      readPending.resolve();
      await resume.promise;
    }
    return captured;
  };
  const delayed = service.joinGroupByCode("user_bob", code, groupId)
    .then(group => ({ group, error: null }), error => ({ group: null, error }));
  let winner;
  try {
    await within(readPending.promise);
    winner = await service.joinGroupByCode("user_bob", code, groupId);
    assert.equal((await original(groupId, "user_bob"))!.status, "active");
  } finally { resume.resolve(); }
  try {
    const repeated = await delayed;
    assert.equal(repeated.error, null,
      `A completed same-account join must survive stale prechecks, received ${repeated.error?.statusCode}/${repeated.error?.code}.`);
    assert.equal(repeated.group!.id, winner.id);
    const activities = await store.listGroupActivities(groupId);
    assert.equal(activities.filter(activity => activity.type === "joined" && activity.actorUserId === "user_bob").length, 1);
    const members = await store.listGroupMembers(groupId);
    assert.equal(members.filter(member => member.status === "active" && member.userId === "user_bob").length, 1);
  } finally { store.findGroupMember = original; }
}

test("a duplicate join with a stale pending snapshot succeeds after its peer takes the last group slot", async () => {
  await assertRepeatedJoinSurvivesStalePrecheck(2, false);
});

test("a duplicate join with a stale pending snapshot succeeds after its peer reaches the user's group quota", async () => {
  await assertRepeatedJoinSurvivesStalePrecheck(3, true);
});
