import assert from "node:assert/strict";
import test from "node:test";
import { BodyLogGrowthService } from "../../src/modules/bodylog/bodylog-growth.service.ts";
import { InMemoryBodyLogGrowthStore } from "../../src/modules/bodylog/bodylog-stores.ts";

function setup() {
  const store = new InMemoryBodyLogGrowthStore();
  const service = new BodyLogGrowthService(store);
  const plan = store.createGrowthPlan({ userId: "alice", startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-08T00:00:00.000Z", status: "active", completedMissions: 0, totalMissions: 7, timeZone: "UTC" });
  for (let day = 1; day <= 7; day++) store.createGrowthMission({ planId: plan.id, day, type: "localGoal", target: 1, completed: false });
  const reward = store.createGrowthReward({ planId: plan.id, type: "badge", value: "7_day_champion", claimed: false });
  return { store, service, plan, reward };
}

const aggregate = (day = 1, completedGoalCount = 1) => ({ localDate: `2026-01-0${day}`, timeZone: "UTC",
  completedGoalCount, eligibleGoalCount: 2, definitionVersion: 1, eventId: "00000000-0000-4000-8000-000000000001" });
const error = (code: string, statusCode: number) => (value: any) => {
  assert.equal(value.code, code); assert.equal(value.statusCode, statusCode); return true;
};

test("enrollment creates seven local goal missions and one reward in the selected time zone", async () => {
  const store = new InMemoryBodyLogGrowthStore(); const service = new BodyLogGrowthService(store);
  const plan = await service.enroll("alice", "Asia/Shanghai");
  assert.equal(plan.totalMissions, 7); assert.equal(plan.timeZone, "Asia/Shanghai");
  assert.deepEqual((await service.getMissions("alice", plan.id)).map(m => [m.day, m.type, m.target, m.completed]),
    Array.from({ length: 7 }, (_, i) => [i + 1, "localGoal", 1, false]));
  assert.equal((await service.getRewards("alice", plan.id)).length, 1);
  await assert.rejects(service.enroll("alice"), error("BODYLOG_GROWTH_PLAN_ACTIVE", 409));
  await assert.rejects(service.enroll("bob", "Mars/Olympus"), error("BODYLOG_GROWTH_AGGREGATE_INVALID", 400));
});

test("growth plan, mission and reward reads enforce account ownership and missing resources", async () => {
  const { service, plan, reward } = setup();
  await assert.rejects(service.getPlan("alice", "missing"), error("BODYLOG_GROWTH_PLAN_NOT_FOUND", 404));
  for (const read of [() => service.getPlan("bob", plan.id), () => service.getMissions("bob", plan.id),
    () => service.getRewards("bob", plan.id), () => service.claimReward("bob", plan.id, reward.id),
    () => service.submitDailyAggregate("bob", plan.id, aggregate())])
    await assert.rejects(read(), error("BODYLOG_GROWTH_PLAN_FORBIDDEN", 403));
  assert.equal((await service.getLatestPlan("alice"))?.id, plan.id);
  assert.equal(await service.getLatestPlan("bob"), null);
});

test("legacy manual completion always requires local aggregate evidence", async () => {
  const { store, service, plan } = setup(); const [mission] = await service.getMissions("alice", plan.id);
  await assert.rejects(service.completeMission("alice", plan.id, mission!.id), error("BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED", 409));
  assert.equal(store.findGrowthMissionById(mission!.id)?.completed, false);
  await assert.rejects(service.completeMission("alice", plan.id, "missing"), error("BODYLOG_GROWTH_MISSION_NOT_FOUND", 404));
  const foreign = store.createGrowthMission({ planId: "another-plan", day: 1, type: "localGoal", target: 1, completed: false });
  await assert.rejects(service.completeMission("alice", plan.id, foreign.id), error("BODYLOG_GROWTH_MISSION_MISMATCH", 400));
});

test("daily aggregate retries count once and a correction reverses the same mission", async () => {
  const { store, service, plan } = setup();
  await Promise.all(Array.from({ length: 4 }, () => service.submitDailyAggregate("alice", plan.id, aggregate())));
  assert.equal((await service.getPlan("alice", plan.id)).completedMissions, 1);
  await service.submitDailyAggregate("alice", plan.id, aggregate(1, 0));
  assert.equal((await service.getPlan("alice", plan.id)).completedMissions, 0);
  const [mission] = store.findGrowthMissionsByPlanId(plan.id);
  assert.equal(mission?.completed, false); assert.equal(mission?.completedAt, null);
});

test("seven daily aggregates complete the plan and reward claims replay safely", async () => {
  const { service, plan, reward } = setup();
  await assert.rejects(service.claimReward("alice", plan.id, reward.id), error("BODYLOG_GROWTH_PLAN_INACTIVE", 409));
  for (let day = 1; day <= 7; day++) await service.submitDailyAggregate("alice", plan.id, aggregate(day));
  assert.equal((await service.getPlan("alice", plan.id)).status, "completed");
  assert.equal(await service.getActivePlan("alice"), null);
  const claimed = await service.claimReward("alice", plan.id, reward.id);
  assert.equal(claimed.claimed, true);
  assert.deepEqual(await service.claimReward("alice", plan.id, reward.id), claimed);
  await assert.rejects(service.submitDailyAggregate("alice", plan.id, aggregate(1, 0)), error("BODYLOG_GROWTH_AGGREGATE_LOCKED", 409));
  assert.equal((await service.getPlan("alice", plan.id)).completedMissions, 7);
});

test("unclaimed completed plans can be corrected and later completed again", async () => {
  const { service, plan } = setup();
  for (let day = 1; day <= 7; day++) await service.submitDailyAggregate("alice", plan.id, aggregate(day));
  await service.submitDailyAggregate("alice", plan.id, aggregate(2, 0));
  assert.equal((await service.getPlan("alice", plan.id)).status, "active");
  assert.equal((await service.getPlan("alice", plan.id)).completedMissions, 6);
  await service.submitDailyAggregate("alice", plan.id, aggregate(2));
  assert.equal((await service.getPlan("alice", plan.id)).status, "completed");
});

test("invalid dates and aggregate counts return application errors without changing progress", async () => {
  const { service, plan } = setup();
  for (const patch of [{ localDate: "2026-13-01" }, { localDate: "2026-02-30" }, { localDate: "2026-00-01" },
    { localDate: "9999-01-01" }, { timeZone: "Mars/Olympus" }, { completedGoalCount: -1 },
    { completedGoalCount: 3 }, { eligibleGoalCount: 501 }, { completedGoalCount: 0.5 },
    { definitionVersion: 2 }, { eventId: "invalid" }])
    await assert.rejects(service.submitDailyAggregate("alice", plan.id, { ...aggregate(), ...patch }), error("BODYLOG_GROWTH_AGGREGATE_INVALID", 400));
  assert.equal((await service.getPlan("alice", plan.id)).completedMissions, 0);
});

test("aggregate dates and time zones must belong to the enrolled plan", async () => {
  const { store, service, plan } = setup();
  await assert.rejects(service.submitDailyAggregate("alice", plan.id, { ...aggregate(), timeZone: "Asia/Shanghai" }), error("BODYLOG_GROWTH_AGGREGATE_TIME_ZONE_MISMATCH", 400));
  for (const localDate of ["2025-12-31", "2026-01-08"])
    await assert.rejects(service.submitDailyAggregate("alice", plan.id, { ...aggregate(), localDate }), error("BODYLOG_GROWTH_AGGREGATE_OUT_OF_PLAN", 400));
  store.updateGrowthPlan(plan.id, { status: "cancelled" });
  await assert.rejects(service.submitDailyAggregate("alice", plan.id, aggregate()), error("BODYLOG_GROWTH_PLAN_NOT_ACTIVE", 409));
});

test("legacy plans without local goal missions reject aggregate evidence", async () => {
  const { store, service } = setup();
  const legacy = store.createGrowthPlan({ userId: "bob", startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2026-01-08T00:00:00.000Z", status: "active", completedMissions: 0, totalMissions: 21, timeZone: "UTC" });
  await assert.rejects(service.submitDailyAggregate("bob", legacy.id, aggregate()), error("BODYLOG_GROWTH_MISSION_DEFINITION_MISSING", 409));
});


test("reward claims reject missing rewards and rewards from another plan", async () => {
  const { store, service, plan } = setup();
  await assert.rejects(service.claimReward("alice", plan.id, "missing"), error("BODYLOG_GROWTH_REWARD_NOT_FOUND", 404));
  const foreign = store.createGrowthReward({ planId: "another-plan", type: "badge", value: "champion", claimed: false });
  await assert.rejects(service.claimReward("alice", plan.id, foreign.id), error("BODYLOG_GROWTH_REWARD_MISMATCH", 400));
});

test("aggregate day assignment uses the enrolled local date across UTC midnight", async () => {
  const { store, service } = setup();
  const plan = store.createGrowthPlan({ userId: "bob", startDate: "2026-01-01T20:00:00.000Z",
    endDate: "2026-01-08T20:00:00.000Z", status: "active", completedMissions: 0, totalMissions: 7, timeZone: "Asia/Shanghai" });
  const mission = store.createGrowthMission({ planId: plan.id, day: 1, type: "localGoal", target: 1, completed: false });
  await service.submitDailyAggregate("bob", plan.id, { ...aggregate(2), timeZone: "Asia/Shanghai" });
  assert.equal(store.findGrowthMissionById(mission.id)?.completed, true);
});
