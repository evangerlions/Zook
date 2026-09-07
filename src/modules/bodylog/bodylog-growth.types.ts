export type GrowthPlanStatus = "active" | "completed" | "cancelled";
export type MissionType = "steps" | "water" | "sleep";

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
