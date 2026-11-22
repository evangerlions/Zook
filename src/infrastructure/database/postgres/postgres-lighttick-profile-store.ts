import type {
  LightTickOwner, LightTickProfileRow, LightTickWeeklyPlanningBudget,
} from "../../../modules/lighttick/lighttick.types.ts";
import { versionConflict } from "./postgres-lighttick-conflicts.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";

export class PostgresLightTickProfileStore {
  constructor(private readonly query: QueryClient["query"]) {}

  async getProfile(owner: LightTickOwner): Promise<LightTickProfileRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_profiles WHERE app_id = $1 AND user_id = $2", [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickProfileRow>(result.rows[0]) : undefined;
  }

  async saveProfile(row: LightTickProfileRow, expectedVersion?: number): Promise<LightTickProfileRow> {
    const values = [row.timezone, row.locale, row.pace, row.onboardingState,
      JSON.stringify(row.notificationPreferences), JSON.stringify(row.onboardingDraft), row.appId, row.userId];
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_profiles SET timezone=$1, locale=$2, pace=$3,
        onboarding_state=$4, notification_preferences=$5::jsonb, onboarding_draft=$6::jsonb,
        version=version+1, updated_at=NOW() WHERE app_id=$7 AND user_id=$8 AND version=$9 RETURNING *`, [...values, expectedVersion]);
      if (!result.rows[0]) versionConflict(row.userId);
      return mapRow<LightTickProfileRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_profiles
      (app_id,user_id,timezone,locale,pace,onboarding_state,notification_preferences,onboarding_draft,version,created_at,updated_at)
      VALUES ($7,$8,$1,$2,$3,$4,$5::jsonb,$6::jsonb,1,NOW(),NOW()) RETURNING *`, values);
    return mapRow<LightTickProfileRow>(result.rows[0]!);
  }

  async getWeeklyPlanningBudget(owner: LightTickOwner): Promise<LightTickWeeklyPlanningBudget | undefined> {
    const result = await this.query(`SELECT weekly_available_minutes, plan_percent, version
      FROM zook_lighttick_weekly_planning_budgets WHERE app_id=$1 AND user_id=$2`, [owner.appId, owner.userId]);
    const row = result.rows[0];
    return row ? {
      version: Number(row.version),
      weekly_available_minutes: row.weekly_available_minutes === null ? null : Number(row.weekly_available_minutes),
      plan_percent: Number(row.plan_percent),
    } : undefined;
  }

  async saveWeeklyPlanningBudget(owner: LightTickOwner, budget: LightTickWeeklyPlanningBudget): Promise<LightTickWeeklyPlanningBudget> {
    const values = [owner.appId, owner.userId, budget.weekly_available_minutes, budget.plan_percent, budget.version];
    const result = budget.version === 1
      ? await this.query(`INSERT INTO zook_lighttick_weekly_planning_budgets
        (app_id,user_id,weekly_available_minutes,plan_percent,version) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (app_id,user_id) DO NOTHING RETURNING weekly_available_minutes,plan_percent,version`, values)
      : await this.query(`UPDATE zook_lighttick_weekly_planning_budgets SET weekly_available_minutes=$3,plan_percent=$4,version=$5
        WHERE app_id=$1 AND user_id=$2 AND version=$5-1 RETURNING weekly_available_minutes,plan_percent,version`, values);
    if (!result.rows[0]) versionConflict(owner.userId);
    return budget;
  }
}
