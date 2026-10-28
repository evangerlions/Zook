import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers!.push({
    id: `app_${userId}_bodylog`, appId: "bodylog", userId,
    status: "ACTIVE", joinedAt: new Date().toISOString(),
  });
  const runtime = await createApplication({ seed });
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", true);
  await stores.flags.updateBodyLogFeatureFlag("growth", true);
  const headers = (userId: string, appId = "bodylog") => ({
    authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, appId)}`,
    "x-app-id": "bodylog",
  });
  const request = (userId: string, path: string, body?: unknown) => runtime.app.handle({
    method: body === undefined ? "GET" : "POST", path: `/api/v1/bodylog${path}`,
    headers: headers(userId), body,
  });
  return { runtime, stores, headers, request };
}

const protectedReads = ["/entitlements", "/missions", "/rewards", "/campaigns/active"];

test("retention reads require bearer authentication even when device or user headers are forged", async () => {
  const { runtime } = await setup();
  for (const path of protectedReads) {
    for (const headers of [{}, { "x-user-id": "user_alice", "x-device-id": "spoofed-device", "x-app-id": "bodylog" }]) {
      const response = await runtime.app.handle({ method: "GET", path: `/api/v1/bodylog${path}`, headers });
      assert.equal(response.statusCode, 401, path);
    }
  }
});

test("retention reads reject a valid bearer from a different application", async () => {
  const { runtime, headers } = await setup();
  for (const path of protectedReads) {
    const response = await runtime.app.handle({
      method: "GET", path: `/api/v1/bodylog${path}`, headers: headers("user_alice", "app_a"),
    });
    assert.equal(response.statusCode, 403, path);
  }
});

test("an account without issued rewards has no promotional premium or fabricated sources", async () => {
  const { request } = await setup();
  const response = await request("user_alice", "/entitlements");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.code, "OK");
  assert.deepEqual(response.body.data.effective, { isPremium: false, sources: [], premiumUntil: null });
  assert.deepEqual(response.body.data.promotional, []);
});

test("mission and reward ledgers aggregate the authenticated account's actual seven-day plan only", async () => {
  const { stores, request } = await setup();
  const plan = await stores.growth.createGrowthPlan({ userId: "user_alice",
    startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-08T00:00:00.000Z",
    status: "active", completedMissions: 1, totalMissions: 7, timeZone: "UTC" });
  const mission = await stores.growth.createGrowthMission({ planId: plan.id, day: 1,
    type: "localGoal", target: 1, completed: true });
  const reward = await stores.growth.createGrowthReward({ planId: plan.id, type: "badge",
    value: "7_day_champion", claimed: false });
  const missions = await request("user_alice", "/missions");
  assert.equal(missions.statusCode, 200);
  assert.equal(missions.body.code, "OK");
  assert.ok(Array.isArray(missions.body.data));
  assert.ok(missions.body.data.some((item: any) => item.id === mission.id && item.source === "sevenDayPlan"));
  const rewards = await request("user_alice", "/rewards");
  assert.equal(rewards.statusCode, 200);
  assert.ok(Array.isArray(rewards.body.data));
  assert.ok(rewards.body.data.some((item: any) => item.id === reward.id && item.source === "sevenDayPlan"));
  for (const path of ["/missions", "/rewards"]) {
    const otherAccount = await request("user_bob", path);
    assert.equal(otherAccount.statusCode, 200);
    assert.deepEqual(otherAccount.body.data, []);
  }
  const entitlements = await request("user_alice", "/entitlements");
  assert.equal(entitlements.body.data.effective.isPremium, false, "An unclaimed badge is not Premium");
});

test("a spoofed user header cannot select another account's retention ledger", async () => {
  const { runtime, stores, headers } = await setup();
  const plan = await stores.growth.createGrowthPlan({ userId: "user_alice",
    startDate: "2026-01-01T00:00:00.000Z", endDate: "2026-01-08T00:00:00.000Z",
    status: "active", completedMissions: 0, totalMissions: 7, timeZone: "UTC" });
  await stores.growth.createGrowthMission({ planId: plan.id, day: 1, type: "localGoal", target: 1, completed: false });
  const response = await runtime.app.handle({ method: "GET", path: "/api/v1/bodylog/missions",
    headers: { ...headers("user_bob"), "x-user-id": "user_alice", "x-device-id": "install-alice" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body.data, []);
});

test("unconfigured campaign discovery returns an empty authenticated list", async () => {
  const { request } = await setup();
  const response = await request("user_alice", "/campaigns/active");
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.code, "OK");
  assert.deepEqual(response.body.data, { campaigns: [] });
});

test("unknown campaigns and client-authored approval cannot issue promotional entitlement", async () => {
  const { request } = await setup();
  const forged = { userId: "user_bob", status: "verified", verified: true, approved: true,
    isPremium: true, rewardClaimStatus: "readyToClaim", premiumUntil: "2099-01-01T00:00:00.000Z",
    platform: "other", url: "https://example.com/review" };
  for (const action of ["join", "submit", "claim"]) {
    const response = await request("user_alice", `/campaigns/nonexistent/${action}`, forged);
    assert.equal(response.statusCode, 404, action);
  }
  for (const userId of ["user_alice", "user_bob"]) {
    const response = await request(userId, "/entitlements");
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.data.effective.isPremium, false);
    assert.deepEqual(response.body.data.promotional, []);
  }
});

test("three server-recorded invitation days issue discoverable rewards once for both participants", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: new Date("2026-10-01T12:00:00.000Z") });
  const { request } = await setup();
  const invitation = await request("user_alice", "/invitations", { installId: "alice-retention-install" });
  assert.equal(invitation.statusCode, 200);
  const attribution = await request("user_bob", "/invitations/attribute", {
    token: invitation.body.data.token, installId: "bob-retention-install",
  });
  assert.equal(attribution.statusCode, 200);
  const enrolled = await request("user_bob", "/seven-day-plan/enroll", { timeZone: "UTC" });
  assert.equal(enrolled.statusCode, 200);
  for (let day = 0; day < 3; day++) {
    if (day > 0) t.mock.timers.tick(86_400_000);
    const localDate = new Date().toISOString().slice(0, 10);
    const recorded = await request("user_bob", `/seven-day-plan/${enrolled.body.data.id}/daily-aggregate`, {
      localDate, timeZone: "UTC", completedGoalCount: 1, eligibleGoalCount: 1,
      definitionVersion: 1, eventId: randomUUID(),
    });
    assert.equal(recorded.statusCode, 200);
    assert.equal((await request("user_bob", "/invitations/progress", { date: localDate, timezone: "UTC" })).statusCode, 200);
  }
  const localDate = new Date().toISOString().slice(0, 10);
  const beforeReplay = new Map<string, unknown>();
  for (const userId of ["user_alice", "user_bob"]) {
    const entitlements = await request(userId, "/entitlements");
    assert.equal(entitlements.statusCode, 200);
    assert.equal(entitlements.body.data.effective.isPremium, true);
    assert.ok(entitlements.body.data.effective.sources.includes("invitation"));
    assert.equal(entitlements.body.data.promotional.length, 1);
    beforeReplay.set(userId, entitlements.body.data);
    const rewards = await request(userId, "/rewards");
    assert.equal(rewards.statusCode, 200);
    assert.ok(rewards.body.data.some((item: any) => item.source === "invitation"));
  }
  assert.equal((await request("user_bob", "/invitations/progress", { date: localDate, timezone: "UTC" })).statusCode, 200);
  for (const userId of ["user_alice", "user_bob"]) {
    const confirmed = await request(userId, "/entitlements");
    assert.deepEqual(confirmed.body.data, beforeReplay.get(userId), "A progress replay cannot extend or duplicate its entitlement");
  }
});
