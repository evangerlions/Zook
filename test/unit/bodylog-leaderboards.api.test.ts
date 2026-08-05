import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { currentBodyLogSeasonLabel } from "../../src/modules/bodylog/bodylog-leaderboard.service.ts";
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
  for (const userId of ["user_alice", "user_bob"]) {
    value.appUsers?.push({
      id: `app_${userId}_bodylog`, appId: "bodylog", userId,
      status: "ACTIVE", joinedAt: new Date().toISOString(),
    });
  }
  return value;
}

function weekDates(): string[] {
  const date = new Date();
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - day + 1);
  return Array.from({ length: 7 }, (_, index) => {
    const next = new Date(date);
    next.setUTCDate(date.getUTCDate() + index);
    return next.toISOString().slice(0, 10);
  });
}

test("public leaderboard defaults off, requires three days, ignores client score, and hides on exit", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const bob = runtime.services.tokenService.issueAccessToken("user_bob", "bodylog");
  const headers = (token: string) => ({
    authorization: `Bearer ${token}`, "x-app-id": "bodylog", "x-time-zone": "UTC",
  });
  const seasonLabel = currentBodyLogSeasonLabel(new Date(), "UTC");
  const dates = weekDates();

  const initial = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/leaderboards/current/public",
    headers: headers(bob),
  });
  assert.deepEqual(initial.body.data.entries, []);

  const joined = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/leaderboards/current/join",
    headers: headers(alice),
    body: {
      seasonLabel, timezone: "UTC",
      habits: [{ habitId: "opaque-habit-a", scheduledDates: dates }],
    },
  });
  assert.equal(joined.statusCode, 200);
  assert.equal(joined.body.data.membership.joined, true);

  for (const date of dates.slice(0, 2)) {
    await runtime.app.handle({
      method: "POST", path: "/api/v1/bodylog/leaderboards/current/aggregate",
      headers: headers(alice),
      body: { seasonLabel, date, completedHabitIds: ["opaque-habit-a"], score: 1000 },
    });
  }
  const tooEarly = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/leaderboards/current/public",
    headers: headers(bob),
  });
  assert.deepEqual(tooEarly.body.data.entries, []);

  const third = await runtime.app.handle({
    method: "POST", path: "/api/v1/bodylog/leaderboards/current/aggregate",
    headers: headers(alice),
    body: {
      seasonLabel, date: dates[2],
      completedHabitIds: ["opaque-habit-a", "opaque-habit-a"], score: 1000,
    },
  });
  assert.equal(third.body.data.eligible, true);
  assert.equal(third.body.data.score < 100, true);

  const ranked = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/leaderboards/current/public",
    headers: headers(bob),
  });
  assert.equal(ranked.body.data.entries[0].userId, "user_alice");
  assert.equal("habits" in ranked.body.data.entries[0], false);

  await runtime.app.handle({
    method: "DELETE", path: "/api/v1/bodylog/leaderboards/current/membership",
    headers: headers(alice), body: { timezone: "UTC" },
  });
  const afterExit = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/leaderboards/current/public",
    headers: headers(bob),
  });
  assert.deepEqual(afterExit.body.data.entries, []);
});

test("friend leaderboard excludes non-friends and blocked users", async () => {
  const runtime = await createApplication({ seed: seed() });
  const alice = runtime.services.tokenService.issueAccessToken("user_alice", "bodylog");
  const headers = {
    authorization: `Bearer ${alice}`, "x-app-id": "bodylog", "x-time-zone": "UTC",
  };
  const response = await runtime.app.handle({
    method: "GET", path: "/api/v1/bodylog/leaderboards/current/friends", headers,
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data.entries, []);
});
