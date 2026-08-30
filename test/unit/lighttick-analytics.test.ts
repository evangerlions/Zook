import assert from "node:assert/strict";
import test from "node:test";
import { LightTickAnalyticsService, LIGHTTICK_SERVER_EVENTS } from "../../src/modules/lighttick/lighttick-analytics.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

test("LightTick server facts are allowlisted, redacted, and deduplicated by authoritative operation", async () => {
  const runtime = await createApplication({ seed: buildDefaultSeed(undefined, { includeLightTick: true }), lighttickEnabled: true });
  const analytics = new LightTickAnalyticsService(runtime.services.analyticsService, () => new Date("2026-08-30T00:00:00Z"));
  const command = {
    userId: "lighttick_analytics_user", event: "lighttick_task_completed" as const,
    dedupeKey: "task-1:complete:operation-1", pageKey: "today", platform: "ios" as const,
    metadata: { operation_id: "operation-1", resource_id: "task-1", variant: "light", actual_minutes: 12,
      note: "must never be stored", coach_text: "private", access_token: "secret", wish: "unapproved free text",
      arbitrary: "not allowlisted" },
  };
  await analytics.record(command); await analytics.record(command);
  const events = runtime.database.analyticsEvents.filter(item => item.appId === "lighttick");
  assert.equal(events.length, 1); assert.equal(events[0]?.eventName, "lighttick_task_completed");
  assert.deepEqual(events[0]?.metadata, { operation_id: "operation-1", resource_id: "task-1", variant: "light", actual_minutes: 12 });
  assert.equal(JSON.stringify(events).includes("must never be stored"), false);
  assert.equal(JSON.stringify(events).includes("secret"), false);
  assert.equal(JSON.stringify(events).includes("unapproved free text"), false);
});

test("LightTick taxonomy covers the complete Phase 1 funnel, recovery, conflict, and notification outcomes", () => {
  for (const event of ["lighttick_guest_created", "lighttick_wish_submitted", "lighttick_starter_shown", "lighttick_starter_started",
    "lighttick_starter_completed", "lighttick_preview_viewed", "lighttick_weekly_commitment", "lighttick_plan_confirmed",
    "lighttick_task_started", "lighttick_task_completed", "lighttick_task_skipped", "lighttick_task_deferred",
    "lighttick_goal_paused", "lighttick_goal_resumed", "lighttick_recovery_started", "lighttick_return_observed",
    "lighttick_review_viewed", "lighttick_proposal_accepted", "lighttick_proposal_rejected", "lighttick_sync_conflict",
    "lighttick_notification_queued", "lighttick_notification_delivered", "lighttick_notification_suppressed", "lighttick_notification_failed"])
    assert.equal(LIGHTTICK_SERVER_EVENTS.has(event as never), true, event);
});

test("route retries emit one server-owned funnel fact per event without storing wish content", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "member_analytics", appId: "lighttick", userId: "user_alice", status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: "2026-08-30T00:00:00Z" });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const token = runtime.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const request = { method: "POST", path: "/api/v1/lighttick/onboarding/starter", headers: {
    authorization: `Bearer ${token}`, "x-app-id": "lighttick", "x-client-platform": "ios",
    "idempotency-key": "analytics-starter-operation-001" },
    body: { wish: "private wish must not enter telemetry", timezone: "Asia/Shanghai", locale: "zh-CN" }, requestId: "analytics-1" };
  assert.equal((await runtime.app.handle(request)).statusCode, 201);
  assert.equal((await runtime.app.handle({ ...request, requestId: "analytics-2" })).statusCode, 201);
  const events = runtime.database.analyticsEvents.filter(item => item.appId === "lighttick");
  assert.deepEqual(events.map(item => item.eventName).sort(), ["lighttick_starter_shown", "lighttick_wish_submitted"]);
  assert.equal(JSON.stringify(events).includes("private wish must not enter telemetry"), false);
});
