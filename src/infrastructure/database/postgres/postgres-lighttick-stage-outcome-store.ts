import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  StageOutcomeEvidenceHistory, StageOutcomeEvidenceRow, StageOutcomeEvidenceStore, StageOutcomeEvidenceWindow,
} from "../../../modules/lighttick/planning/stage-outcome-evidence-store.ts";
import { versionConflict } from "./postgres-lighttick-conflicts.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";
import { timestampString } from "./postgres-lighttick-row-mappers.ts";

const stageProjection = `SELECT entry.*,
  to_char(entry.occurred_on, 'YYYY-MM-DD') AS occurrence_date,
  NOT EXISTS (SELECT 1 FROM zook_lighttick_outcome_evidence correction WHERE
    correction.app_id=entry.app_id AND correction.user_id=entry.user_id AND correction.goal_id=entry.goal_id
    AND correction.roadmap_stage_id=entry.roadmap_stage_id AND correction.corrected_from=entry.id) AS effective
  FROM zook_lighttick_outcome_evidence entry
  WHERE entry.app_id=$1 AND entry.user_id=$2 AND entry.goal_id=$3 AND entry.roadmap_stage_id IS NOT NULL`;

function stageEvidenceOf(row: Record<string, unknown>): StageOutcomeEvidenceHistory {
  return {
    id: String(row.id), appId: String(row.app_id), userId: String(row.user_id), goalId: String(row.goal_id),
    stageId: String(row.roadmap_stage_id), occurredOn: String(row.occurrence_date), recordedAt: timestampString(row.created_at),
    metric: String(row.metric), version: Number(row.version), kind: row.kind, value: row.value,
    ...(typeof row.task_id === "string" ? { taskId: row.task_id, taskTitle: row.task_title } : {}),
    ...(typeof row.corrected_from === "string" ? { correctedFrom: row.corrected_from } : {}),
    isCurrent: row.effective === true,
  } as StageOutcomeEvidenceHistory;
}

export class PostgresLightTickStageOutcomeStore implements StageOutcomeEvidenceStore {
  constructor(private readonly query: QueryClient["query"]) {}

  async list(owner: LightTickOwner, goalId: string, { stageId, startsOn, endsOn }: StageOutcomeEvidenceWindow = {}) {
    const { rows } = await this.query(`${stageProjection} AND ($4::text IS NULL OR entry.roadmap_stage_id=$4)
      AND ($5::date IS NULL OR entry.occurred_on >= $5) AND ($6::date IS NULL OR entry.occurred_on <= $6)
      ORDER BY entry.occurred_on DESC, entry.created_at DESC, entry.id`,
    [owner.appId, owner.userId, goalId, stageId ?? null, startsOn ?? null, endsOn ?? null]);
    return rows.map(stageEvidenceOf);
  }

  async get(owner: LightTickOwner, goalId: string, stageId: string, id: string) {
    const { rows } = await this.query(`${stageProjection} AND entry.roadmap_stage_id=$4 AND entry.id=$5`,
      [owner.appId, owner.userId, goalId, stageId, id]);
    return rows[0] ? stageEvidenceOf(rows[0]) : undefined;
  }

  async stageIds(owner: LightTickOwner, goalId: string) {
    const { rows } = await this.query(`SELECT DISTINCT roadmap_stage_id FROM zook_lighttick_outcome_evidence
      WHERE app_id=$1 AND user_id=$2 AND goal_id=$3 AND roadmap_stage_id IS NOT NULL`, [owner.appId, owner.userId, goalId]);
    return rows.map(row => String(row.roadmap_stage_id));
  }

  async add(row: StageOutcomeEvidenceRow) {
    const { rows } = await this.query(`INSERT INTO zook_lighttick_outcome_evidence
      (id, app_id, user_id, goal_id, roadmap_stage_id, occurred_on, metric, kind, value, task_id, task_title, corrected_from,
       source, confirmed, occurred_at, version, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6::date,$7,$8,$9::jsonb,$10,$11,$12,'user',true,$6::date::timestamp AT TIME ZONE 'UTC',$13,$14,$14)
      ON CONFLICT DO NOTHING RETURNING id`,
    [row.id, row.appId, row.userId, row.goalId, row.stageId, row.occurredOn, row.metric, row.kind, JSON.stringify(row.value),
      row.taskId ?? null, row.taskTitle ?? null, row.correctedFrom ?? null, row.version, row.recordedAt]);
    if (!rows[0]) versionConflict(row.id);
  }
}
