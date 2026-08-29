import assert from "node:assert/strict";
import test from "node:test";
import { parseLightTickProfileRow, parseLightTickTaskRow } from "../../src/modules/lighttick/lighttick-row-parser.ts";

const timestamps = { created_at: new Date("2026-08-19T00:00:00Z"), updated_at: "2026-08-19T01:00:00Z" };

test("LightTick row parsers enforce app ownership and normalize database values", () => {
  const profile = parseLightTickProfileRow({
    app_id: "lighttick", user_id: "user_a", timezone: "Asia/Shanghai", locale: "zh-CN",
    pace: "balanced", onboarding_state: "drafting", notification_preferences: { enabled: true },
    onboarding_draft: "{\"goal\":\"ship\"}", version: "2", ...timestamps,
  });
  assert.equal(profile.createdAt, "2026-08-19T00:00:00.000Z");
  assert.equal(profile.onboardingDraft.goal, "ship");
  assert.equal(profile.version, 2);

  assert.throws(() => parseLightTickTaskRow({
    app_id: "bodylog", user_id: "user_a", id: "task", goal_id: "goal", plan_id: "plan",
    title: "task", status: "pending", priority: 1, estimated_minutes: 15, version: 1, ...timestamps,
  }), /foreign app_id/);
});
