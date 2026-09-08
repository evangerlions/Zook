import { ApplicationError } from "../../shared/errors.ts";
import type { BodyLogGrowthStore } from "../../infrastructure/bodylog-store-ports.ts";
import type {
  BodyLogGrowthPlan,
  BodyLogGrowthPlanDocument,
  BodyLogGrowthMission,
  BodyLogGrowthMissionDocument,
  BodyLogGrowthReward,
  BodyLogGrowthRewardDocument,
} from "./bodylog-growth.types.ts";

const PLAN_DURATION_DAYS = 7;
const MISSIONS_PER_DAY = 3;

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

  async enroll(userId: string): Promise<BodyLogGrowthPlanDocument> {
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
      totalMissions: PLAN_DURATION_DAYS * MISSIONS_PER_DAY,
    });

    // Create missions for each day
    const missionTypes = ["steps", "water", "sleep"] as const;
    const targets = [8000, 2000, 480]; // steps, water (ml), sleep (minutes)

    for (let day = 1; day <= PLAN_DURATION_DAYS; day++) {
      for (let i = 0; i < missionTypes.length; i++) {
        await this.database.createGrowthMission({
          planId: plan.id,
          day,
          type: missionTypes[i],
          target: targets[i],
          completed: false,
        });
      }
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
    // Verify user has access to this plan
    const plan = await this.getPlan(userId, planId);

    if (plan.status !== "active") {
      throw new ApplicationError(
        400,
        "BODYLOG_GROWTH_PLAN_INACTIVE",
        "Cannot complete missions for an inactive plan.",
      );
    }

    const mission = await this.database.findGrowthMissionById(missionId);
    if (!mission) {
      throw new ApplicationError(
        404,
        "BODYLOG_GROWTH_MISSION_NOT_FOUND",
        "Mission not found.",
      );
    }

    if (mission.planId !== planId) {
      throw new ApplicationError(
        400,
        "BODYLOG_GROWTH_MISSION_MISMATCH",
        "Mission does not belong to this plan.",
      );
    }

    if (mission.completed) {
      throw new ApplicationError(
        409,
        "BODYLOG_GROWTH_MISSION_COMPLETED",
        "Mission already completed.",
      );
    }

    const completedAt = new Date().toISOString();
    const updatedMission = this.database.completeGrowthMission
      ? await this.database.completeGrowthMission(missionId, completedAt)
      : await this.database.updateGrowthMission(missionId, { completed: true, completedAt });
    if (!updatedMission) {
      throw new ApplicationError(409, "BODYLOG_GROWTH_MISSION_COMPLETED", "Mission already completed.");
    }

    // Update plan's completed missions count
    if (!this.database.completeGrowthMission) {
      await this.database.incrementGrowthPlanCompletedMissions(planId);
    }

    // Check if all missions are completed
    const updatedPlan = await this.database.findGrowthPlanById(planId);
    if (updatedPlan && updatedPlan.completedMissions === updatedPlan.totalMissions) {
      await this.database.updateGrowthPlan(planId, {
        status: "completed",
      });
    }

    return toMissionDocument(updatedMission);
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

    if (reward.claimed) {
      throw new ApplicationError(
        409,
        "BODYLOG_GROWTH_REWARD_CLAIMED",
        "Reward already claimed.",
      );
    }

    if (plan.status !== 'completed' || plan.completedMissions < plan.totalMissions) {
      throw new ApplicationError(409, 'BODYLOG_GROWTH_PLAN_INACTIVE', 'Complete the plan before claiming its reward.');
    }
    const claimedAt = new Date().toISOString();
    const updatedReward = this.database.claimGrowthReward
      ? await this.database.claimGrowthReward(rewardId, claimedAt)
      : await this.database.updateGrowthReward(rewardId, { claimed: true, claimedAt });
    if (!updatedReward) {
      throw new ApplicationError(409, "BODYLOG_GROWTH_REWARD_CLAIMED", "Reward already claimed.");
    }

    return toRewardDocument(updatedReward);
  }
}
