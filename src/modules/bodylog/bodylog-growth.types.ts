export type GrowthPlanStatus = "active" | "completed" | "cancelled";
export type MissionType = "steps" | "water" | "sleep" | "localGoal";

export interface BodyLogGrowthDailyAggregate {
  userId: string;
  localDate: string;
  timeZone: string;
  completedGoalCount: number;
  eligibleGoalCount: number;
  definitionVersion: number;
  eventId: string;
  updatedAt: string;
}

export interface UpsertGrowthDailyAggregateInput extends Omit<BodyLogGrowthDailyAggregate, "updatedAt"> {}

export interface ApplyGrowthDailyAggregateResult {
  aggregate: BodyLogGrowthDailyAggregate | null;
  locked: boolean;
}

export interface BodyLogGrowthPlan {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  status: GrowthPlanStatus;
  completedMissions: number;
  totalMissions: number;
  createdAt: string;
  updatedAt: string;
  timeZone?: string;
}

export interface BodyLogGrowthPlanDocument {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  status: GrowthPlanStatus;
  completedMissions: number;
  totalMissions: number;
  createdAt: string;
  updatedAt: string;
  timeZone?: string;
}

export interface BodyLogGrowthMission {
  id: string;
  planId: string;
  day: number;
  type: MissionType;
  target: number;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface BodyLogGrowthMissionDocument {
  id: string;
  planId: string;
  day: number;
  type: MissionType;
  target: number;
  completed: boolean;
  completedAt: string | null;
  createdAt: string;
}

export interface BodyLogGrowthReward {
  id: string;
  planId: string;
  type: string;
  value: string;
  claimed: boolean;
  claimedAt: string | null;
  createdAt: string;
}

export interface BodyLogGrowthRewardDocument {
  id: string;
  planId: string;
  type: string;
  value: string;
  claimed: boolean;
  claimedAt: string | null;
  createdAt: string;
}

export interface CreateGrowthPlanInput {
  userId: string;
  startDate: string;
  endDate: string;
  status: GrowthPlanStatus;
  completedMissions: number;
  totalMissions: number;
  timeZone?: string;
}

export interface CreateGrowthMissionInput {
  planId: string;
  day: number;
  type: MissionType;
  target: number;
  completed: boolean;
}

export interface CreateGrowthRewardInput {
  planId: string;
  type: string;
  value: string;
  claimed: boolean;
}

export interface UpdateGrowthMissionInput {
  completed: boolean;
  completedAt: string | null;
}

export interface UpdateGrowthPlanInput {
  status?: GrowthPlanStatus;
  completedMissions?: number;
}

export interface UpdateGrowthRewardInput {
  claimed: boolean;
  claimedAt: string | null;
}
