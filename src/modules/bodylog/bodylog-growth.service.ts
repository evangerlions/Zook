import { ApplicationError } from "../../shared/errors.ts";
import type { BodyLogGrowthStore } from "../../infrastructure/bodylog-store-ports.ts";
import type {
  BodyLogGrowthPlan,
  BodyLogGrowthPlanDocument,
  BodyLogGrowthMission,
  BodyLogGrowthMissionDocument,
  BodyLogGrowthReward,
  BodyLogGrowthRewardDocument,
  BodyLogGrowthDailyAggregate,
  UpsertGrowthDailyAggregateInput,
} from "./bodylog-growth.types.ts";

const PLAN_DURATION_DAYS = 7;
const MISSION_DEFINITION_VERSION = 1;
const MAX_ELIGIBLE_GOALS_PER_DAY = 500;

function assertTimeZone(timeZone: string): void {
  try { new Intl.DateTimeFormat("en", { timeZone }).format(); }
  catch { throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_INVALID", "timeZone must be a valid IANA time zone."); }
}

function localDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateOrdinal(localDate: string): number {
  const [year, month, day] = localDate.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / 86_400_000;
}

function validateDailyAggregate(input: UpsertGrowthDailyAggregateInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.localDate) ||
      !Number.isFinite(Date.parse(`${input.localDate}T00:00:00.000Z`)) ||
      new Date(`${input.localDate}T00:00:00.000Z`).toISOString().slice(0, 10) !== input.localDate) {
    throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_INVALID", "localDate must be a valid YYYY-MM-DD date.");
  }
  assertTimeZone(input.timeZone);
  if (!Number.isInteger(input.completedGoalCount) || !Number.isInteger(input.eligibleGoalCount) ||
      input.eligibleGoalCount < 0 || input.eligibleGoalCount > MAX_ELIGIBLE_GOALS_PER_DAY ||
      input.completedGoalCount < 0 || input.completedGoalCount > input.eligibleGoalCount) {
    throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_INVALID", "Goal counts are outside the supported range.");
  }
  if (input.definitionVersion !== MISSION_DEFINITION_VERSION ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId)) {
    throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_INVALID", "definitionVersion or eventId is invalid.");
  }
  if (input.localDate > localDateAt(new Date(), input.timeZone)) {
    throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_INVALID", "Future local dates cannot be submitted.");
  }
}

function toPlanDocument(record: BodyLogGrowthPlan): BodyLogGrowthPlanDocument {
  return {
    id: record.id,
    userId: record.userId,
    startDate: record.startDate,
    endDate: record.endDate,
    status: record.status,
    completedMissions: record.completedMissions,
    totalMissions: record.totalMissions,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    timeZone: record.timeZone ?? "UTC",
  };
}

function toMissionDocument(record: BodyLogGrowthMission): BodyLogGrowthMissionDocument {
  return {
    id: record.id,
    planId: record.planId,
    day: record.day,
    type: record.type,
    target: record.target,
    completed: record.completed,
    completedAt: record.completedAt,
    createdAt: record.createdAt,
  };
}

function toRewardDocument(record: BodyLogGrowthReward): BodyLogGrowthRewardDocument {
  return {
    id: record.id,
    planId: record.planId,
    type: record.type,
    value: record.value,
    claimed: record.claimed,
    claimedAt: record.claimedAt,
    createdAt: record.createdAt,
  };
}

export class BodyLogGrowthService {
  constructor(private readonly database: BodyLogGrowthStore) {}

  async enroll(userId: string, timeZone = "UTC"): Promise<BodyLogGrowthPlanDocument> {
    assertTimeZone(timeZone);
    // Check if user already has an active plan
    const activePlan = await this.database.findActiveGrowthPlan(userId);
    if (activePlan) {
      throw new ApplicationError(
        409,
        "BODYLOG_GROWTH_PLAN_ACTIVE",
        "User already has an active growth plan.",
      );
    }

    const now = new Date();
    const startDate = now.toISOString();
    const endDate = new Date(now.getTime() + PLAN_DURATION_DAYS * 24 * 60 * 60 * 1000).toISOString();

    // Create the plan
    const plan = await this.database.createGrowthPlan({
      userId,
      startDate,
      endDate,
      status: "active",
      completedMissions: 0,
      totalMissions: PLAN_DURATION_DAYS,
      timeZone,
    });

    // Create missions for each day
    for (let day = 1; day <= PLAN_DURATION_DAYS; day++) {
      await this.database.createGrowthMission({
        planId: plan.id,
        day,
        type: "localGoal",
        target: 1,
        completed: false,
      });
    }

    // Create completion reward
    await this.database.createGrowthReward({
      planId: plan.id,
      type: "badge",
      value: "7_day_champion",
      claimed: false,
    });

    return toPlanDocument(plan);
  }

  async getPlan(userId: string, planId: string): Promise<BodyLogGrowthPlanDocument> {
    const plan = await this.database.findGrowthPlanById(planId);
    if (!plan) {
      throw new ApplicationError(
        404,
        "BODYLOG_GROWTH_PLAN_NOT_FOUND",
        "Growth plan not found.",
      );
    }

    if (plan.userId !== userId) {
      throw new ApplicationError(
        403,
        "BODYLOG_GROWTH_PLAN_FORBIDDEN",
        "You do not have access to this growth plan.",
      );
    }

    return toPlanDocument(plan);
  }

  async getLatestPlan(userId: string): Promise<BodyLogGrowthPlanDocument | null> {
    const plan = await this.database.findLatestGrowthPlan(userId);
    return plan ? toPlanDocument(plan) : null;
  }

  async getActivePlan(userId: string): Promise<BodyLogGrowthPlanDocument | null> {
    const plan = await this.database.findActiveGrowthPlan(userId);
    if (!plan) {
      return null;
    }
    return toPlanDocument(plan);
  }

  async getMissions(userId: string, planId: string): Promise<BodyLogGrowthMissionDocument[]> {
    // Verify user has access to this plan
    await this.getPlan(userId, planId);

    const missions = await this.database.findGrowthMissionsByPlanId(planId);
    return missions.map(toMissionDocument);
  }

  async completeMission(
    userId: string,
    planId: string,
    missionId: string,
  ): Promise<BodyLogGrowthMissionDocument> {
    await this.getPlan(userId, planId);
    const mission = await this.database.findGrowthMissionById(missionId);
    if (!mission) throw new ApplicationError(404, "BODYLOG_GROWTH_MISSION_NOT_FOUND", "Mission not found.");
    if (mission.planId !== planId) throw new ApplicationError(400, "BODYLOG_GROWTH_MISSION_MISMATCH", "Mission does not belong to this plan.");
    throw new ApplicationError(409, "BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED", "Missions complete automatically after a qualifying local goal aggregate is received.");
  }

  async submitDailyAggregate(
    userId: string,
    planId: string,
    input: Omit<UpsertGrowthDailyAggregateInput, "userId">,
  ): Promise<BodyLogGrowthDailyAggregate> {
    const aggregateInput: UpsertGrowthDailyAggregateInput = { ...input, userId };
    validateDailyAggregate(aggregateInput);
    await this.getPlan(userId, planId);
    const plan = await this.database.findGrowthPlanById(planId);
    if (!plan || !["active", "completed"].includes(plan.status)) throw new ApplicationError(409, "BODYLOG_GROWTH_PLAN_NOT_ACTIVE", "This seven-day plan no longer accepts progress.");
    if (plan.timeZone && input.timeZone !== plan.timeZone) throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_TIME_ZONE_MISMATCH", "The aggregate time zone must match the enrolled plan.");

    const startLocalDate = localDateAt(new Date(plan.startDate), input.timeZone);
    const day = dateOrdinal(input.localDate) - dateOrdinal(startLocalDate) + 1;
    if (day < 1 || day > PLAN_DURATION_DAYS) {
      throw new ApplicationError(400, "BODYLOG_GROWTH_AGGREGATE_OUT_OF_PLAN", "localDate is outside the active plan.");
    }
    const shouldComplete = input.completedGoalCount >= 1;
    const result = await this.database.applyGrowthDailyAggregate(plan.id, day, aggregateInput, shouldComplete, new Date().toISOString());
    if (result.locked) throw new ApplicationError(409, "BODYLOG_GROWTH_AGGREGATE_LOCKED", "Daily progress is locked after a plan reward is claimed.");
    if (!result.aggregate) throw new ApplicationError(409, "BODYLOG_GROWTH_MISSION_DEFINITION_MISSING", "The active plan does not accept this local-goal aggregate.");
    return result.aggregate;
  }

  async getRewards(userId: string, planId: string): Promise<BodyLogGrowthRewardDocument[]> {
    // Verify user has access to this plan
    await this.getPlan(userId, planId);

    const rewards = await this.database.findGrowthRewardsByPlanId(planId);
    return rewards.map(toRewardDocument);
  }

  async claimReward(
    userId: string,
    planId: string,
    rewardId: string,
  ): Promise<BodyLogGrowthRewardDocument> {
    // Verify user has access to this plan
    const plan = await this.getPlan(userId, planId);

    const reward = await this.database.findGrowthRewardById(rewardId);
    if (!reward) {
      throw new ApplicationError(
        404,
        "BODYLOG_GROWTH_REWARD_NOT_FOUND",
        "Reward not found.",
      );
    }

    if (reward.planId !== planId) {
      throw new ApplicationError(
        400,
        "BODYLOG_GROWTH_REWARD_MISMATCH",
        "Reward does not belong to this plan.",
      );
    }

    if (reward.claimed) return toRewardDocument(reward);

    if (plan.status !== 'completed' || plan.completedMissions < plan.totalMissions) {
      throw new ApplicationError(409, 'BODYLOG_GROWTH_PLAN_INACTIVE', 'Complete the plan before claiming its reward.');
    }
    const claimedAt = new Date().toISOString();
    const updatedReward = this.database.claimGrowthReward
      ? await this.database.claimGrowthReward(rewardId, claimedAt)
      : await this.database.updateGrowthReward(rewardId, { claimed: true, claimedAt });
    if (!updatedReward) {
      const refreshedReward = await this.database.findGrowthRewardById(rewardId);
      if (refreshedReward?.claimed) return toRewardDocument(refreshedReward);
      const refreshedPlan = await this.database.findGrowthPlanById(planId);
      if (!refreshedPlan || refreshedPlan.status !== "completed" || refreshedPlan.completedMissions < refreshedPlan.totalMissions) {
        throw new ApplicationError(409, "BODYLOG_GROWTH_PLAN_INACTIVE", "Complete the plan before claiming its reward.");
      }
      throw new ApplicationError(409, "BODYLOG_GROWTH_REWARD_CLAIMED", "Reward claim could not be confirmed.");
    }

    return toRewardDocument(updatedReward);
  }
}
