import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("analytics service calculates DAU, new users and page duration metrics per app", async () => {
  const runtime = await createApplication();

  runtime.database.appUsers.push({
    id: "app_user_bob_a",
    appId: "app_a",
    userId: "user_bob",
    status: "ACTIVE",
    joinedAt: "2026-03-06T11:00:00+08:00",
  });

  await runtime.services.analyticsService.recordBatch({
    appId: "app_a",
    userId: "user_alice",
    events: [
      {
        platform: "web",
        sessionId: "sess_a1",
        pageKey: "/home",
        eventName: "page_view",
        occurredAt: "2026-03-06T10:00:00+08:00",
      },
      {
        platform: "web",
        sessionId: "sess_a1",
        pageKey: "/home",
        eventName: "page_leave",
        durationMs: 3000,
        occurredAt: "2026-03-06T10:05:00+08:00",
      },
    ],
  });

  await runtime.services.analyticsService.recordBatch({
    appId: "app_a",
    userId: "user_bob",
    events: [
      {
        platform: "web",
        sessionId: "sess_b1",
        pageKey: "/home",
        eventName: "page_view",
        occurredAt: "2026-03-06T11:00:00+08:00",
      },
      {
        platform: "web",
        sessionId: "sess_b1",
        pageKey: "/home",
        eventName: "page_heartbeat",
        durationMs: 1500,
        occurredAt: "2026-03-06T11:00:15+08:00",
      },
      {
        platform: "ios",
        sessionId: "sess_b2",
        pageKey: "/profile",
        eventName: "page_leave",
        durationMs: 5000,
        occurredAt: "2026-03-07T09:00:00+08:00",
      },
    ],
  });

  await runtime.services.analyticsService.recordBatch({
    appId: "app_b",
    userId: "user_alice",
    events: [
      {
        platform: "web",
        sessionId: "sess_other",
        pageKey: "/ignored",
        eventName: "page_leave",
        durationMs: 9000,
        occurredAt: "2026-03-06T12:00:00+08:00",
      },
    ],
  });

  const overview = await runtime.services.analyticsService.getOverview("app_a", "2026-03-06", "2026-03-07");
  assert.deepEqual(overview.items, [
    { date: "2026-03-06", dau: 2, newUsers: 1 },
    { date: "2026-03-07", dau: 1, newUsers: 0 },
  ]);

  const pages = await runtime.services.analyticsService.getPageMetrics("app_a", "2026-03-06", "2026-03-07");
  assert.deepEqual(pages.items, [
    {
      pageKey: "/profile",
      platform: "ios",
      uv: 1,
      sessionCount: 1,
      totalDurationMs: 5000,
      avgDurationMs: 5000,
    },
    {
      pageKey: "/home",
      platform: "web",
      uv: 2,
      sessionCount: 2,
      totalDurationMs: 4500,
      avgDurationMs: 2250,
    },
  ]);
});
