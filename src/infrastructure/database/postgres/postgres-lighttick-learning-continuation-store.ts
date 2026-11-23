import type { LearningContinuationRepository, LearningContinuationRow } from "../../../modules/lighttick/learning/learning-continuation.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";

const table = "zook_lighttick_learning_continuations";
const fields = `c.app_id AS "appId", c.user_id AS "userId", c.task_id AS "taskId",
  c.scheduled_date::text AS "scheduledDate", c.due_date::text AS "dueDate", c.phase,
  to_char(c.reminder_time, 'HH24:MI') AS "reminderTime", c.moved_version AS "movedVersion",
  c.adjustment_reason AS "adjustmentReason"`;

export class PostgresLightTickLearningContinuationStore implements LearningContinuationRepository {
  constructor(private readonly query: (sql: string, values: unknown[]) => Promise<QueryResult>) {}

  async get(owner: LightTickOwner, taskId: string): Promise<LearningContinuationRow | undefined> {
    const result = await this.query(`SELECT ${fields} FROM ${table} c
      WHERE c.app_id=$1 AND c.user_id=$2 AND c.task_id=$3`, [owner.appId, owner.userId, taskId]);
    return result.rows[0] as unknown as LearningContinuationRow | undefined;
  }

  async list(owner: LightTickOwner): Promise<LearningContinuationRow[]> {
    const result = await this.query(`SELECT ${fields} FROM ${table} c
      WHERE c.app_id=$1 AND c.user_id=$2`, [owner.appId, owner.userId]);
    return result.rows as unknown as LearningContinuationRow[];
  }

  async listDue(now: Date, limit: number): Promise<LearningContinuationRow[]> {
    const local = "($1::timestamptz AT TIME ZONE COALESCE(p.timezone, 'UTC'))";
    const result = await this.query(`SELECT ${fields} FROM ${table} c
      LEFT JOIN zook_lighttick_profiles p ON p.app_id=c.app_id AND p.user_id=c.user_id
      WHERE c.phase IN ('rollover', 'reminder')
        AND c.due_date<=($1::timestamptz AT TIME ZONE 'Pacific/Kiritimati')::date
        AND c.due_date<=${local}::date
        AND (c.phase='rollover' OR c.due_date<${local}::date OR c.reminder_time<=${local}::time)
      ORDER BY c.due_date, c.app_id, c.user_id, c.task_id LIMIT $2`, [now.toISOString(), limit]);
    return result.rows as unknown as LearningContinuationRow[];
  }

  async save(row: LearningContinuationRow): Promise<void> {
    await this.query(`INSERT INTO ${table}
      (app_id,user_id,task_id,scheduled_date,due_date,phase,reminder_time,moved_version,adjustment_reason)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (app_id,user_id,task_id) DO UPDATE SET
        scheduled_date=EXCLUDED.scheduled_date,due_date=EXCLUDED.due_date,phase=EXCLUDED.phase,
        reminder_time=EXCLUDED.reminder_time,moved_version=EXCLUDED.moved_version,
        adjustment_reason=EXCLUDED.adjustment_reason`,
    [row.appId, row.userId, row.taskId, row.scheduledDate, row.dueDate, row.phase,
      row.reminderTime ?? null, row.movedVersion ?? null, row.adjustmentReason ?? null]);
  }
}
