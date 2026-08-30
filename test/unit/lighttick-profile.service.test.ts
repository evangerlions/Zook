import assert from "node:assert/strict";
import test from "node:test";
import { LightTickProfileService } from "../../src/modules/lighttick/lighttick-profile.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "user_a" } as const;
const fixed = new Date("2026-08-20T08:00:00Z");

test("onboarding persists resumable profile, draft goal constraints, event, and change", async () => {
  const repository = new InMemoryLightTickRepository();
  const service = new LightTickProfileService(repository, () => fixed);
  const result = await service.submitOnboarding(owner, { title: "Run a marathon", currentLevel: "Can run 5 km",
    weeklyAvailableMinutes: 240, pace: "balanced", timezone: "Asia/Shanghai", targetDate: "2027-03-01",
    availabilityWindows: [{ weekday: 6, startTime: "08:00", endTime: "10:00" }] });
  assert.equal(result.profile.onboardingState, "drafting");
  assert.equal(result.profile.onboardingDraft.title, "Run a marathon");
  assert.equal(result.goal.status, "draft");
  assert.equal(result.goal.constraints.weekly_available_minutes, 240);
  assert.equal((await repository.listExecutionEvents(owner)).length, 1);
  assert.equal((await repository.pullChanges(owner, 0, 10)).length, 1);

  const resumed = await service.getProfile(owner);
  assert.equal(resumed?.onboardingDraft.currentLevel, "Can run 5 km");
});

test("onboarding rejects invalid timezone, budget, and availability windows without partial writes", async () => {
  const repository = new InMemoryLightTickRepository();
  const service = new LightTickProfileService(repository, () => fixed);
  const baseline = { title: "Goal", currentLevel: "Beginner", weeklyAvailableMinutes: 120,
    pace: "balanced" as const, timezone: "Asia/Shanghai" };
  for (const input of [
    { ...baseline, timezone: "Mars/Olympus" },
    { ...baseline, weeklyAvailableMinutes: 10 },
    { ...baseline, availabilityWindows: [{ weekday: 1, startTime: "10:00", endTime: "09:00" }] },
  ]) await assert.rejects(service.submitOnboarding(owner, input));
  assert.equal(await repository.getProfile(owner), undefined);
  assert.deepEqual(await repository.listGoals(owner), []);
});

test("notification preferences validate clocks and merge partial updates", async () => {
  const repository = new InMemoryLightTickRepository(); const service = new LightTickProfileService(repository, () => fixed);
  await service.submitOnboarding(owner, { title: "Goal", currentLevel: "Beginner", weeklyAvailableMinutes: 120,
    pace: "balanced", timezone: "Asia/Shanghai" });
  const initial = (await service.getProfile(owner))!;
  const quiet = await service.updateProfile(owner, initial.version, { notificationPreferences: {
    quiet_hours_start: "22:00", quiet_hours_end: "07:00", enabled: true,
  } });
  const updated = await service.updateProfile(owner, quiet.version, { notificationPreferences: { review_reminders: false } });
  assert.deepEqual(updated.notificationPreferences, { quiet_hours_start: "22:00", quiet_hours_end: "07:00",
    enabled: true, review_reminders: false });
  await assert.rejects(service.updateProfile(owner, updated.version, { notificationPreferences: { quiet_hours_start: "25:00" } }));
  await assert.rejects(service.updateProfile(owner, updated.version, { notificationPreferences: { token: "secret" } }));
});
