import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

function socialSeed(): DatabaseSeed {
  const seed = buildDefaultSeed();
  seed.apps?.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" },
    status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO",
    createdAt: "2026-07-29T00:00:00.000Z",
  });
  for (const userId of ["user_alice", "user_bob"]) {
    seed.appUsers?.push({
      id: `app_${userId}_bodylog`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: "2026-07-29T00:00:00.000Z",
    });
  }
  return seed;
}

test("BodyLog friendship requires recipient acceptance", async () => {
  const runtime = await createApplication({ seed: socialSeed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const bob = runtime.services.tokenService.issueAccessToken("user_bob", "bodylog");
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`,
    "x-app-id": "bodylog",
  });

  const created = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/friend-requests", headers: headers(alice),
    body: { targetUserId: "user_bob" },
  });
  assert.equal(created.statusCode, 200);

  const beforeAccept = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/friends", headers: headers(alice),
  });
  assert.deepEqual(beforeAccept.body.data, []);

  const incoming = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/friend-requests", headers: headers(bob),
  });
  assert.equal(incoming.body.data[0].direction, "incoming");
  assert.equal(incoming.body.data[0].profile.userId, "user_alice");

  const accepted = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/bodylog/friend-requests/${created.body.data.id}/accept`,
    headers: headers(bob),
  });
  assert.equal(accepted.body.data.status, "accepted");

  const friends = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/friends", headers: headers(alice),
  });
  assert.equal(friends.body.data.length, 1);
  assert.equal(friends.body.data[0].userId, "user_bob");
});

test("BodyLog block removes friendship and prevents new requests", async () => {
  const runtime = await createApplication({ seed: socialSeed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const bob = runtime.services.tokenService.issueAccessToken("user_bob", "bodylog");
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`, "x-app-id": "bodylog",
  });
  await runtime.database.insertBodyLogFriendship({
    appId: "bodylog", userId: "user_alice", friendUserId: "user_bob",
    createdAt: "2026-07-29T00:00:00.000Z",
  });

  const blocked = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/blocks", headers: headers(alice),
    body: { targetUserId: "user_bob" },
  });
  assert.equal(blocked.statusCode, 200);

  const friends = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/friends", headers: headers(alice),
  });
  assert.deepEqual(friends.body.data, []);

  const request = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/friend-requests", headers: headers(bob),
    body: { targetUserId: "user_alice" },
  });
  assert.equal(request.statusCode, 403);
  assert.equal(request.body.code, "BODYLOG_BLOCKED");
});

test("BodyLog reports accept fixed reasons and reject free-form values", async () => {
  const runtime = await createApplication({ seed: socialSeed() });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const headers = { authorization: `Bearer ${token}`, "x-app-id": "bodylog" };

  const accepted = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/reports", headers,
    body: { targetUserId: "user_bob", reason: "offensive_profile" },
  });
  assert.equal(accepted.statusCode, 200);

  const rejected = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/reports", headers,
    body: { targetUserId: "user_bob", reason: "我想输入一段文字" },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.body.code, "BODYLOG_REPORT_REASON_INVALID");
});
