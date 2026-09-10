import type { Pool, PoolClient } from "pg";
import type {
  BodyLogGrowthPlan,
  BodyLogGrowthMission,
  BodyLogGrowthReward,
  CreateGrowthPlanInput,
  CreateGrowthMissionInput,
  CreateGrowthRewardInput,
  UpdateGrowthMissionInput,
  UpdateGrowthPlanInput,
  UpdateGrowthRewardInput,
} from "../../../modules/bodylog/bodylog-growth.types.ts";

export async function createPostgresGrowthPlan(
  pool: Pool,
  input: CreateGrowthPlanInput,
): Promise<BodyLogGrowthPlan> {
  const result = await pool.query(
    `INSERT INTO bodylog_seven_day_plans (
      user_id, start_date, end_date, status, completed_missions, total_missions, app_id
    ) VALUES ($1, $2, $3, $4, $5, $6, 'bodylog')
    RETURNING *`,
    [
      input.userId,
      input.startDate,
      input.endDate,
      input.status,
      input.completedMissions,
      input.totalMissions,
    ],
  );
  return mapPlanRow(result.rows[0]);
}

export async function findPostgresGrowthPlanById(
  pool: Pool,
  planId: string,
): Promise<BodyLogGrowthPlan | null> {
  const result = await pool.query(
    `SELECT * FROM bodylog_seven_day_plans WHERE id = $1`,
    [planId],
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}

export async function findPostgresActiveGrowthPlan(
  pool: Pool,
  userId: string,
): Promise<BodyLogGrowthPlan | null> {
  const result = await pool.query(
    `SELECT * FROM bodylog_seven_day_plans
     WHERE user_id = $1 AND status = 'active'
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId],
  );
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}

export async function updatePostgresGrowthPlan(
  pool: Pool,
  planId: string,
  input: UpdateGrowthPlanInput,
): Promise<BodyLogGrowthPlan> {
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (input.status !== undefined) {
    updates.push(`status = $${paramIndex++}`);
    values.push(input.status);
  }

  if (input.completedMissions !== undefined) {
    updates.push(`completed_missions = $${paramIndex++}`);
    values.push(input.completedMissions);
  }

  updates.push(`updated_at = NOW()`);
  values.push(planId);

  const result = await pool.query(
    `UPDATE bodylog_seven_day_plans
     SET ${updates.join(", ")}
     WHERE id = $${paramIndex}
     RETURNING *`,
    values,
  );

  if (!result.rows[0]) {
    throw new Error(`Growth plan ${planId} not found`);
  }

  return mapPlanRow(result.rows[0]);
}

export async function incrementPostgresGrowthPlanCompletedMissions(
  pool: Pool,
  planId: string,
): Promise<void> {
  await pool.query(
    `UPDATE bodylog_seven_day_plans
     SET completed_missions = completed_missions + 1,
         updated_at = NOW()
     WHERE id = $1`,
    [planId],
  );
}

export async function createPostgresGrowthMission(
  pool: Pool,
  input: CreateGrowthMissionInput,
): Promise<BodyLogGrowthMission> {
  const result = await pool.query(
    `INSERT INTO bodylog_missions (
      plan_id, day, type, target, completed
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [input.planId, input.day, input.type, input.target, input.completed],
  );
  return mapMissionRow(result.rows[0]);
}

export async function findPostgresGrowthMissionById(
  pool: Pool,
  missionId: string,
): Promise<BodyLogGrowthMission | null> {
  const result = await pool.query(
    `SELECT * FROM bodylog_missions WHERE id = $1`,
    [missionId],
  );
  return result.rows[0] ? mapMissionRow(result.rows[0]) : null;
}

export async function findPostgresGrowthMissionsByPlanId(
  pool: Pool,
  planId: string,
): Promise<BodyLogGrowthMission[]> {
  const result = await pool.query(
    `SELECT * FROM bodylog_missions
     WHERE plan_id = $1
     ORDER BY day, type`,
    [planId],
  );
  return result.rows.map(mapMissionRow);
}

export async function updatePostgresGrowthMission(
  pool: Pool,
  missionId: string,
  input: UpdateGrowthMissionInput,
): Promise<BodyLogGrowthMission> {
  const result = await pool.query(
    `UPDATE bodylog_missions
     SET completed = $2,
         completed_at = $3,
         updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [missionId, input.completed, input.completedAt],
  );

  if (!result.rows[0]) {
    throw new Error(`Growth mission ${missionId} not found`);
  }

  return mapMissionRow(result.rows[0]);
}

export async function completePostgresGrowthMission(
  pool: Pool,
  missionId: string,
  completedAt: string,
): Promise<BodyLogGrowthMission | null> {
  const result = await pool.query(
    `WITH completed_mission AS (UPDATE bodylog_missions
     SET completed = TRUE, completed_at = $2, updated_at = NOW()
     WHERE id = $1 AND completed = FALSE
     RETURNING *), updated_plan AS (
       UPDATE bodylog_seven_day_plans p
       SET completed_missions = p.completed_missions + 1,
           status = CASE WHEN p.completed_missions + 1 >= p.total_missions THEN 'completed' ELSE p.status END,
           updated_at = NOW()
       FROM completed_mission m WHERE p.id = m.plan_id
       RETURNING p.id
     ) SELECT m.* FROM completed_mission m JOIN updated_plan p ON p.id = m.plan_id`,
    [missionId, completedAt],
  );
  return result.rows[0] ? mapMissionRow(result.rows[0]) : null;
}

export async function createPostgresGrowthReward(
  pool: Pool,
  input: CreateGrowthRewardInput,
): Promise<BodyLogGrowthReward> {
  const result = await pool.query(
    `INSERT INTO bodylog_rewards (
      plan_id, type, value, claimed
    ) VALUES ($1, $2, $3, $4)
    RETURNING *`,
    [input.planId, input.type, input.value, input.claimed],
  );
  return mapRewardRow(result.rows[0]);
}

export async function findPostgresGrowthRewardById(
  pool: Pool,
  rewardId: string,
): Promise<BodyLogGrowthReward | null> {
  const result = await pool.query(
    `SELECT * FROM bodylog_rewards WHERE id = $1`,
    [rewardId],
  );
  return result.rows[0] ? mapRewardRow(result.rows[0]) : null;
}

export async function findPostgresGrowthRewardsByPlanId(
  pool: Pool,
  planId: string,
): Promise<BodyLogGrowthReward[]> {
  const result = await pool.query(
    `SELECT * FROM bodylog_rewards
     WHERE plan_id = $1
     ORDER BY created_at`,
    [planId],
  );
  return result.rows.map(mapRewardRow);
}

export async function updatePostgresGrowthReward(
  pool: Pool,
  rewardId: string,
  input: UpdateGrowthRewardInput,
): Promise<BodyLogGrowthReward> {
  const result = await pool.query(
    `UPDATE bodylog_rewards
     SET claimed = $2,
         claimed_at = $3
     WHERE id = $1
     RETURNING *`,
    [rewardId, input.claimed, input.claimedAt],
  );

  if (!result.rows[0]) {
    throw new Error(`Growth reward ${rewardId} not found`);
  }

  return mapRewardRow(result.rows[0]);
}

export async function claimPostgresGrowthReward(
  pool: Pool,
  rewardId: string,
  claimedAt: string,
): Promise<BodyLogGrowthReward | null> {
  const result = await pool.query(
    `UPDATE bodylog_rewards
     SET claimed = TRUE, claimed_at = $2
     WHERE id = $1 AND claimed = FALSE
     RETURNING *`,
    [rewardId, claimedAt],
  );
  return result.rows[0] ? mapRewardRow(result.rows[0]) : null;
}

function mapPlanRow(row: any): BodyLogGrowthPlan {
  return {
    id: row.id,
    userId: row.user_id,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    completedMissions: row.completed_missions,
    totalMissions: row.total_missions,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMissionRow(row: any): BodyLogGrowthMission {
  return {
    id: row.id,
    planId: row.plan_id,
    day: row.day,
    type: row.type,
    target: row.target,
    completed: row.completed,
    completedAt: row.completed_at,
    createdAt: row.created_at,
  };
}

function mapRewardRow(row: any): BodyLogGrowthReward {
  return {
    id: row.id,
    planId: row.plan_id,
    type: row.type,
    value: row.value,
    claimed: row.claimed,
    claimedAt: row.claimed_at,
    createdAt: row.created_at,
  };
}

/** Retains access to completion rewards after a plan leaves active status. */
export async function findPostgresLatestGrowthPlan(pool: Pool, userId: string): Promise<BodyLogGrowthPlan | null> {
  const result = await pool.query("SELECT * FROM bodylog_seven_day_plans WHERE user_id = $1 AND app_id = 'bodylog' ORDER BY created_at DESC LIMIT 1", [userId]);
  return result.rows[0] ? mapPlanRow(result.rows[0]) : null;
}
