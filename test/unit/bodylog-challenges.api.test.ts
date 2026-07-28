import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import type { DatabaseSeed } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

function seed(): DatabaseSeed {
  const value = buildDefaultSeed();
  value.apps?.push({
    id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" },
    status: "ACTIVE", apiDomain: "bodylog.example.com", joinMode: "AUTO",
    createdAt: new Date().toISOString(),
  });
  for (const userId of ["user_alice", "user_bob", "user_carol"]) {
    value.appUsers?.push({
      id: `app_${userId}_bodylog`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: new Date().toISOString(),
    });
  }
  return value;
}

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "x-app-id": "bodylog" };
}

test("challenge requires friends, starts after acceptance, and ignores client score", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const bob = runtime.services.tokenService.issueAccessToken("user_bob", "bodylog");
  await runtime.database.insertBodyLogFriendship({
    appId: "bodylog", userId: "user_alice", friendUserId: "user_bob",
    createdAt: new Date().toISOString(),
  });

  const created = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/challenges", headers: headers(alice),
    body: {
      themeKey: "steady_week", inviteeUserIds: ["user_bob"], timezone: "UTC",
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.body.data.status, "pending");
  assert.equal(created.body.data.members.length, 2);

  const accepted = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/bodylog/challenges/${created.body.data.id}/respond`,
    headers: headers(bob), body: { action: "accept" },
  });
  assert.equal(accepted.body.data.status, "active");
  assert.equal(typeof accepted.body.data.startDate, "string");

  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  const challenge = (await runtime.database.listBodyLogChallenges("bodylog"))[0];
  const end = new Date(`${today}T12:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 6);
  await runtime.database.updateBodyLogChallenge({
    ...challenge, startDate: today, endDate: end.toISOString().slice(0, 10),
  });
  const progress = await runtime.app.handle({
    method: "POST",
    path: `/api/v1/bodylog/challenges/${created.body.data.id}/progress`,
    headers: headers(bob),
    body: { date: today, completed: true, timezone: "UTC", score: 100 },
  });
  const bobEntry = progress.body.data.members.find(
    (item: { userId: string }) => item.userId === "user_bob",
  );
  assert.equal(bobEntry.effectiveDays, 1);
  assert.equal(bobEntry.score < 100, true);
});

test("challenge rejects non-friends and blocked friends", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const nonFriend = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/challenges", headers: headers(alice),
    body: {
      themeKey: "steady_week", inviteeUserIds: ["user_carol"], timezone: "UTC",
    },
  });
  assert.equal(nonFriend.statusCode, 400);

  await runtime.database.insertBodyLogFriendship({
    appId: "bodylog", userId: "user_alice", friendUserId: "user_bob",
    createdAt: new Date().toISOString(),
  });
  await runtime.database.insertBodyLogBlock({
    appId: "bodylog", blockerUserId: "user_bob", blockedUserId: "user_alice",
    createdAt: new Date().toISOString(),
  });
  const blocked = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/challenges", headers: headers(alice),
    body: {
      themeKey: "steady_week", inviteeUserIds: ["user_bob"], timezone: "UTC",
    },
  });
  assert.equal(blocked.statusCode, 400);
});
