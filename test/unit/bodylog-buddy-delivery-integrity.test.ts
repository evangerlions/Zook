import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog", nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) {
    seed.appUsers!.push({ id: `bodylog_delivery_${userId}`, appId: "bodylog", userId, status: "ACTIVE", joinedAt: new Date().toISOString() });
  }
  const runtime = await createApplication({ seed });
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", true);
  await stores.flags.updateBodyLogFeatureFlag("friends", true);
  const call = (userId: string, method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string) => runtime.app.handle({
    method, path: `/api/v1/bodylog/${path}`, body,
    headers: {
      authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, "bodylog")}`,
      "x-app-id": "bodylog",
      ...(idempotencyKey === undefined ? {} : { "idempotency-key": idempotencyKey }),
    },
  });
  for (const userId of ["user_alice", "user_bob"]) assert.equal((await call(userId, "GET", "profile")).statusCode, 200);
  const created = await call("user_alice", "POST", "buddies", { partnerUserId: "user_bob", sharedHabitIds: ["water"] });
  assert.equal(created.statusCode, 200);
  const pairId = created.body.data.pair.id as string;
  assert.equal((await call("user_bob", "POST", `buddies/${pairId}/accept`)).statusCode, 200);
  return { runtime, stores, call, pairId };
}

test("buddy encouragement retries after a lost response return the same confirmed receipt", async () => {
  const { stores, call, pairId } = await setup();
  const payload = { pairId, emoji: "💪", isSameAction: false };
  const first = await call("user_alice", "POST", "buddies/encourage", payload, "watch-operation-reconnect");
  const replay = await call("user_alice", "POST", "buddies/encourage", payload, "watch-operation-reconnect");
  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(replay.body.data.id, first.body.data.id, "replay must confirm the original encouragement");
  assert.equal(replay.body.data.createdAt, first.body.data.createdAt);
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 1);
  assert.equal((await stores.buddy.listBodyLogBuddyActivities(pairId)).filter(item => item.type === "encouraged").length, 1);
});

test("concurrent phone and Watch deliveries with one operation ID create one encouragement and activity", async () => {
  const { stores, call, pairId } = await setup();
  const payload = { pairId, emoji: "👏", isSameAction: false };
  const replies = await Promise.all(Array.from({ length: 6 }, () => call("user_alice", "POST", "buddies/encourage", payload, "watch-operation-parallel")));
  assert.deepEqual(replies.map(reply => reply.statusCode), [200, 200, 200, 200, 200, 200]);
  assert.equal(new Set(replies.map(reply => reply.body.data.id)).size, 1);
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 1);
  assert.equal((await stores.buddy.listBodyLogBuddyActivities(pairId)).filter(item => item.type === "encouraged").length, 1);
});

test("an encouragement operation ID cannot be reused for a different emoji or action", async () => {
  const { stores, call, pairId } = await setup();
  const original = { pairId, emoji: "💪", isSameAction: false };
  assert.equal((await call("user_alice", "POST", "buddies/encourage", original, "operation-conflict")).statusCode, 200);
  assert.equal((await call("user_alice", "POST", "buddies/encourage", { ...original, emoji: "🔥" }, "operation-conflict")).statusCode, 409);
  assert.equal((await call("user_alice", "POST", "buddies/encourage", { ...original, isSameAction: true, targetHabitId: "water" }, "operation-conflict")).statusCode, 409);
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 1);
  assert.equal((await stores.buddy.listBodyLogBuddyActivities(pairId)).filter(item => item.type === "checked_in").length, 0);
});

test("encouragement operation IDs are scoped to the authenticated sender", async () => {
  const { stores, call, pairId } = await setup();
  const payload = { pairId, emoji: "😊", isSameAction: false };
  const alice = await call("user_alice", "POST", "buddies/encourage", payload, "shared-device-operation");
  const bob = await call("user_bob", "POST", "buddies/encourage", payload, "shared-device-operation");
  assert.equal(alice.statusCode, 200);
  assert.equal(bob.statusCode, 200);
  assert.notEqual(alice.body.data.id, bob.body.data.id);
  assert.equal(alice.body.data.fromUserId, "user_alice");
  assert.equal(bob.body.data.fromUserId, "user_bob");
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 2);
});

test("a blocked buddy cannot receive new or queued encouragements", async () => {
  const { stores, call, pairId } = await setup();
  assert.equal((await call("user_bob", "POST", "blocks", { targetUserId: "user_alice" })).statusCode, 200);
  const response = await call("user_alice", "POST", "buddies/encourage", { pairId, emoji: "💪", isSameAction: false }, "queued-before-block");
  assert.ok([403, 404, 409].includes(response.statusCode), "blocked relationships must reject delivery");
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 0);
});

test("dissolved buddies reject delayed encouragement delivery", async () => {
  const { stores, call, pairId } = await setup();
  assert.equal((await call("user_bob", "POST", `buddies/${pairId}/dissolve`)).statusCode, 200);
  const response = await call("user_alice", "POST", "buddies/encourage", { pairId, emoji: "💪", isSameAction: false }, "queued-before-dissolve");
  assert.equal(response.statusCode, 409);
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 0);
});

test("both buddy accounts can complete real actions, encourage, see the same feed, and dissolve", async () => {
  const { stores, call, pairId } = await setup();
  for (const userId of ["user_alice", "user_bob"]) {
    assert.equal((await call(userId, "POST", "buddies/checkin", { habitId: "water", count: 1, eventId: `${userId}-water-log`, occurredAt: new Date().toISOString() })).statusCode, 200);
    assert.equal((await call(userId, "POST", "buddies/encourage", { pairId, emoji: "👏", isSameAction: false }, `${userId}-encourage`)).statusCode, 200);
  }
  for (const userId of ["user_alice", "user_bob"]) {
    const feed = await call(userId, "GET", `buddies/${pairId}`);
    assert.equal(feed.statusCode, 200);
    assert.equal(feed.body.data.pair.status, "active");
    assert.equal(feed.body.data.activities.filter((item: { type: string }) => item.type === "checked_in").length, 2);
    assert.equal(feed.body.data.encouragements.length, 2);
  }
  assert.equal((await call("user_alice", "POST", `buddies/${pairId}/dissolve`)).body.data.dissolved, true);
  assert.equal((await stores.buddy.findBodyLogBuddyPair(pairId))?.status, "dissolved");
});

test("blocking stops subsequent check-in broadcasts on an existing active buddy pair", async () => {
  const { stores, call, pairId } = await setup();
  assert.equal((await call("user_bob", "POST", "blocks", { targetUserId: "user_alice" })).statusCode, 200);
  const response = await call("user_alice", "POST", "buddies/checkin", {
    habitId: "water", count: 1, eventId: "after-block-private-log", occurredAt: new Date().toISOString(),
  });
  assert.ok([200, 403, 404, 409].includes(response.statusCode));
  const activities = await stores.buddy.listBodyLogBuddyActivities(pairId);
  assert.equal(activities.filter(item => item.type === "checked_in").length, 0, "Blocking must stop disclosure of new habit activity");
});

test("blocking prevents the former buddy from reading the relationship feed", async () => {
  const { call, pairId } = await setup();
  assert.equal((await call("user_bob", "POST", "blocks", { targetUserId: "user_alice" })).statusCode, 200);
  const response = await call("user_alice", "GET", `buddies/${pairId}`);
  assert.ok([403, 404, 409].includes(response.statusCode), "A blocked account cannot retain feed access");
});


test("durable encouragement route requires a key and confirms the same receipt as the compatible route", async () => {
  const { stores, call, pairId } = await setup();
  const body = { pairId, emoji: "💪", isSameAction: false };
  assert.equal((await call("user_alice", "POST", "buddies/encouragements", body)).statusCode, 400);
  const first = await call("user_alice", "POST", "buddies/encouragements", body, "durable-route-key");
  const retry = await call("user_alice", "POST", "buddies/encouragements", body, "durable-route-key");
  const compatible = await call("user_alice", "POST", "buddies/encourage", body, "durable-route-key");
  assert.equal(first.statusCode, 200); assert.equal(retry.statusCode, 200);
  assert.equal(first.body.data.id, retry.body.data.id); assert.equal(first.body.data.id, compatible.body.data.id);
  assert.equal((await stores.buddy.listBodyLogBuddyEncouragements(pairId)).length, 1);
});
