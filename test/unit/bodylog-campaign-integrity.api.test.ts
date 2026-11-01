import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
import { createApplication } from "../support/create-test-application.ts";

const campaign = () => ({
  id: "habit-sharing", status: "active", title: "Share your habit", subtitle: "Publish an honest experience",
  startsAt: new Date(Date.now() - 86_400_000).toISOString(), endsAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  reward: { type: "premium", durationDays: 7, displayText: "7 days Premium" }, rules: ["Publish your own public post with the claim code"],
  platformPolicy: { allowedPlatforms: ["other"], freeFormAllowed: true, oauthPlatforms: [], manualReviewPlatforms: ["other"] },
});

async function setup(definitions: unknown = [campaign()]) {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id: "bodylog", code: "bodylog", name: "BodyLog",
    nameI18n: { "zh-CN": "BodyLog", "en-US": "BodyLog" }, status: "ACTIVE",
    apiDomain: "bodylog.example.com", joinMode: "AUTO", createdAt: new Date().toISOString() });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers!.push({
    id: `app_${userId}_bodylog`, appId: "bodylog", userId, status: "ACTIVE", joinedAt: new Date().toISOString(),
  });
  seed.appConfigs!.push({ id: "cfg-bodylog-campaigns", appId: "bodylog", configKey: "bodylog.campaigns",
    configValue: JSON.stringify(definitions), updatedAt: new Date().toISOString() });
  const runtime = await createApplication({ seed, adminBasicAuth: { username: "reviewer", password: "ReviewPass123!" } });
  const stores = resolveBodyLogStores(runtime.database);
  await stores.flags.updateBodyLogFeatureFlag("accountSocial", true);
  await stores.flags.updateBodyLogFeatureFlag("growth", true);
  const bearer = (userId: string) => ({
    authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(userId, "bodylog")}`, "x-app-id": "bodylog",
  });
  const request = (userId: string, path: string, body?: unknown) => runtime.app.handle({
    method: body === undefined ? "GET" : "POST", path: `/api/v1/bodylog${path}`, headers: bearer(userId), body,
  });
  const login = async () => {
    const response = await runtime.app.handle({ method: "POST", path: "/api/v1/admin/auth/login", headers: {},
      body: { username: "reviewer", password: "ReviewPass123!" } });
    assert.equal(response.statusCode, 200);
    assert.ok(response.headers?.["Set-Cookie"]);
    return response.headers!["Set-Cookie"]!.split(";")[0]!;
  };
  const review = (cookie: string, approved: unknown, userId = "user_alice", id = "habit-sharing") => runtime.app.handle({
    method: "POST", path: `/api/v1/admin/apps/bodylog/campaigns/${id}/participations/${userId}/review`,
    headers: { cookie }, body: { approved },
  });
  const joinAndSubmit = async (extra: Record<string, unknown> = {}) => {
    const joined = await request("user_alice", "/campaigns/habit-sharing/join", {});
    assert.equal(joined.statusCode, 200);
    const submitted = await request("user_alice", "/campaigns/habit-sharing/submit", {
      platform: "other", url: "https://example.com/my-habit-post", ...extra,
    });
    assert.equal(submitted.statusCode, 200);
    return submitted.body.data.participation;
  };
  return { runtime, stores, bearer, request, login, review, joinAndSubmit };
}

test("a real campaign requires manual approval, audited review, and idempotent entitlement issuance", async () => {
  const { runtime, request, login, review, joinAndSubmit } = await setup();
  const active = await request("user_alice", "/campaigns/active");
  assert.equal(active.statusCode, 200);
  assert.equal(active.body.data.campaigns[0].id, "habit-sharing");
  const submitted = await joinAndSubmit({ status: "verified", approved: true, rewardClaimStatus: "ready_to_claim" });
  assert.equal(submitted.status, "manual_review");
  assert.equal(submitted.rewardClaimStatus, "not_eligible");
  assert.equal((await request("user_alice", "/campaigns/habit-sharing/claim", { approved: true })).statusCode, 409);
  assert.equal((await request("user_alice", "/entitlements")).body.data.effective.isPremium, false);
  const cookie = await login();
  const approved = await review(cookie, true);
  assert.equal(approved.statusCode, 200);
  assert.equal(approved.body.data.participation.status, "verified");
  assert.equal(approved.body.data.participation.reviewedBy, "reviewer");
  const audits = runtime.database.auditLogs.filter(item => item.action === "bodylog.campaign.review");
  assert.equal(audits.length, 1);
  assert.equal(audits[0]?.appId, "bodylog");
  assert.equal(audits[0]?.payload.adminUser, "reviewer");
  const claims = await Promise.all(Array.from({ length: 4 }, () => request("user_alice", "/campaigns/habit-sharing/claim", {})));
  assert.ok(claims.every(item => item.statusCode === 200));
  assert.equal(new Set(claims.map(item => item.body.data.reward.entitlementId)).size, 1);
  const entitlements = await request("user_alice", "/entitlements");
  assert.equal(entitlements.statusCode, 200);
  assert.equal(entitlements.body.data.effective.isPremium, true);
  assert.deepEqual(entitlements.body.data.effective.sources, ["campaign"]);
  assert.equal(entitlements.body.data.promotional.length, 1);
  const grant = entitlements.body.data.promotional[0];
  assert.equal(Date.parse(grant.endsAt) - Date.parse(grant.startsAt), 7 * 86_400_000);
  assert.equal((await request("user_alice", "/campaigns/habit-sharing/claim", {})).statusCode, 200);
  assert.deepEqual((await request("user_alice", "/entitlements")).body.data, entitlements.body.data);
});

test("campaign participation and claims are isolated by bearer rather than posted identity", async () => {
  const { request, joinAndSubmit } = await setup();
  const submitted = await joinAndSubmit({ userId: "user_bob" });
  const own = await request("user_alice", "/campaigns/habit-sharing/participation");
  assert.equal(own.body.data.participation.id, submitted.id);
  const other = await request("user_bob", "/campaigns/habit-sharing/participation");
  assert.equal(other.statusCode, 200);
  assert.equal(other.body.data.participation.status, "none");
  assert.equal(other.body.data.participation.id, null);
  assert.equal((await request("user_bob", "/campaigns/habit-sharing/claim", { userId: "user_alice", approved: true })).statusCode, 409);
  assert.equal((await request("user_bob", "/entitlements")).body.data.effective.isPremium, false);
});

test("review requires a real admin session and a boolean decision, and duplicate review cannot silently overwrite", async () => {
  const { runtime, bearer, request, login, review, joinAndSubmit } = await setup();
  await joinAndSubmit();
  const path = "/api/v1/admin/apps/bodylog/campaigns/habit-sharing/participations/user_alice/review";
  for (const headers of [{}, bearer("user_alice"), { authorization: `Basic ${Buffer.from("reviewer:ReviewPass123!").toString("base64")}` }]) {
    const response = await runtime.app.handle({ method: "POST", path, headers, body: { approved: true } });
    assert.equal(response.statusCode, 401);
  }
  const cookie = await login();
  assert.equal((await review(cookie, "true")).statusCode, 400);
  assert.equal((await review(cookie, true)).statusCode, 200);
  assert.equal((await review(cookie, false)).statusCode, 409);
  const current = await request("user_alice", "/campaigns/habit-sharing/participation");
  assert.equal(current.body.data.participation.status, "verified");
  assert.equal(runtime.database.auditLogs.filter(item => item.action === "bodylog.campaign.review").length, 1);
});

test("rejection consumes a retry and still requires review after resubmission", async () => {
  const { request, login, review, joinAndSubmit } = await setup();
  await joinAndSubmit();
  const rejected = await review(await login(), false);
  assert.equal(rejected.statusCode, 200);
  assert.equal(rejected.body.data.participation.retryRemaining, 2);
  assert.equal(rejected.body.data.participation.rejection.retryAllowed, true);
  const resubmitted = await request("user_alice", "/campaigns/habit-sharing/submit", {
    platform: "other", url: "https://example.com/corrected-post", status: "verified",
  });
  assert.equal(resubmitted.statusCode, 200);
  assert.equal(resubmitted.body.data.participation.status, "manual_review");
  assert.equal((await request("user_alice", "/campaigns/habit-sharing/claim", {})).statusCode, 409);
});

test("expired campaigns do not accept new participation or issue rewards", async () => {
  const ended = { ...campaign(), startsAt: "2026-01-01T00:00:00.000Z", endsAt: "2026-01-08T00:00:00.000Z" };
  const { request } = await setup([ended]);
  assert.deepEqual((await request("user_alice", "/campaigns/active")).body.data, { campaigns: [] });
  for (const action of ["join", "submit", "claim"]) {
    assert.equal((await request("user_alice", `/campaigns/habit-sharing/${action}`, {
      platform: "other", url: "https://example.com/post", approved: true,
    })).statusCode, 404);
  }
});

test("malformed complete-definition fields fail closed instead of leaking undecodable active campaigns", async () => {
  const valid = campaign();
  for (const definitions of [
    [valid, { ...valid }],
    [{ ...valid, reward: { ...valid.reward, displayText: null } }],
    [{ ...valid, platformPolicy: { ...valid.platformPolicy, allowedPlatforms: [123] } }],
    [{ ...valid, platformPolicy: { allowedPlatforms: ["other"] } }],
    [{ ...valid, platformPolicy: { ...valid.platformPolicy, freeFormAllowed: "yes" } }],
  ]) {
    const { request } = await setup(definitions);
    const response = await request("user_alice", "/campaigns/active");
    assert.equal(response.statusCode, 503);
    assert.equal(response.body.code, "BODYLOG_CAMPAIGN_CONFIG_INVALID");
  }
});
