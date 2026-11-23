import type {LightTickOwner} from '../../../modules/lighttick/lighttick.types.ts';
import { NATIVE_LEARNING_READING_PHASE } from '../../../modules/lighttick/learning/native-learning-access.ts';
type Query=(sql:string,values?:unknown[])=>Promise<{rows:Record<string,unknown>[]}>;

export interface LightTickSearchHit {
  kind: 'record' | 'goal' | 'task';
  id: string;
  title: string;
  snippet?: string;
  goal_id?: string;
  status?: string;
  updated_at: string;
}

export interface LightTickTimelineItem {
  occurred_at: string;
  kind: 'record' | 'goal' | 'task';
  id: string;
  title: string;
  goal_id?: string;
  status?: string;
  snippet?: string;
}

export interface LightTickTimelineRow extends LightTickTimelineItem {
  cursor_occurred_at: string;
}

export interface TimelineCursor {
  occurred_at: string;
  kind: 'record' | 'goal' | 'task';
  id: string;
}

const KIND_ORDER: Record<LightTickTimelineItem['kind'], number> = { record: 0, goal: 1, task: 2 };

const readableTask = `(
  lesson_source IS NULL OR lesson_source = 'null'::jsonb
  OR EXISTS (
    SELECT 1 FROM zook_lighttick_learning_authorities
    WHERE app_id=$1 AND user_id=$2 AND module='learning'
      AND phase='${NATIVE_LEARNING_READING_PHASE}' AND reading_enabled
  )
)`;

export class PostgresSearchStore {
  constructor(private readonly query: Query) {}

  async searchRecords(owner: LightTickOwner, q: string, limit: number): Promise<LightTickSearchHit[]> {
    const key = q.toLowerCase();
    const result = await this.query(
      `SELECT id, payload, updated_at FROM zook_lighttick_records
       WHERE app_id=$1 AND user_id=$2
         AND (payload->>'archived_at') IS NULL
         AND (position($3 in lower(payload->>'raw_text'))>0
              OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(payload->'tags') tag
                        WHERE position($3 in lower(tag))>0))
       ORDER BY updated_at DESC LIMIT $4`,
      [owner.appId, owner.userId, key, limit],
    );
    return result.rows.map(r => {
      const payload = r.payload as { raw_text?: string };
      const rawText = payload?.raw_text ?? '';
      return {
        kind: 'record' as const,
        id: String(r.id),
        title: rawText.split('\n')[0].slice(0, 200) || 'Record',
        snippet: rawText.length > 200 ? rawText.slice(0, 200) + '…' : rawText,
        updated_at: toIso(r.updated_at),
      };
    });
  }

  async searchGoals(owner: LightTickOwner, q: string, limit: number): Promise<LightTickSearchHit[]> {
    const key = q.toLowerCase();
    const result = await this.query(
      `SELECT id, title, description, status, updated_at FROM zook_lighttick_goals
       WHERE app_id=$1 AND user_id=$2
         AND status NOT IN ('archived')
         AND (position($3 in lower(title))>0 OR position($3 in lower(COALESCE(description,'')))>0)
       ORDER BY updated_at DESC LIMIT $4`,
      [owner.appId, owner.userId, key, limit],
    );
    return result.rows.map(r => ({
      kind: 'goal' as const,
      id: String(r.id),
      title: String(r.title),
      snippet: r.description ? String(r.description).slice(0, 200) : undefined,
      status: String(r.status),
      updated_at: toIso(r.updated_at),
    }));
  }

  async searchTasks(owner: LightTickOwner, q: string, limit: number): Promise<LightTickSearchHit[]> {
    const key = q.toLowerCase();
    const result = await this.query(
      `SELECT id, goal_id, title, notes, status, updated_at FROM zook_lighttick_tasks
       WHERE app_id=$1 AND user_id=$2
         AND ${readableTask}
         AND (position($3 in lower(title))>0 OR position($3 in lower(COALESCE(notes,'')))>0)
       ORDER BY updated_at DESC LIMIT $4`,
      [owner.appId, owner.userId, key, limit],
    );
    return result.rows.map(r => ({
      kind: 'task' as const,
      id: String(r.id),
      title: String(r.title),
      snippet: r.notes ? String(r.notes).slice(0, 200) : undefined,
      goal_id: r.goal_id ? String(r.goal_id) : undefined,
      status: String(r.status),
      updated_at: toIso(r.updated_at),
    }));
  }

  async listTimeline(owner: LightTickOwner, limit: number, cursor?: TimelineCursor): Promise<LightTickTimelineRow[]> {
    const values: unknown[] = [owner.appId, owner.userId];
    const cursorClause = cursor
      ? (() => {
          values.push(cursor.occurred_at, KIND_ORDER[cursor.kind], cursor.id);
          return `WHERE occurred_at < $3::timestamptz OR (
            occurred_at = $3::timestamptz AND (
              kind_rank > $4::int OR (kind_rank = $4::int AND id COLLATE "C" < $5::text COLLATE "C")
            )
          )`;
        })()
      : '';
    // pg converts timestamps to millisecond Dates. Keyset comparisons need the full database precision.
    const sql = `
      WITH combined AS (
        SELECT
          updated_at AS occurred_at,
          0 AS kind_rank,
          id,
          SPLIT_PART(payload->>'raw_text', E'\n', 1) AS title,
          NULL::text AS goal_id,
          NULL::text AS status,
          CASE WHEN length(payload->>'raw_text') > 200
               THEN substr(payload->>'raw_text', 1, 200) || '…'
               ELSE payload->>'raw_text' END AS snippet
        FROM zook_lighttick_records
        WHERE app_id=$1 AND user_id=$2 AND (payload->>'archived_at') IS NULL
        UNION ALL
        SELECT
          updated_at AS occurred_at,
          1 AS kind_rank,
          id,
          title,
          NULL::text AS goal_id,
          status,
          CASE WHEN length(COALESCE(description,'')) > 200
               THEN substr(description, 1, 200) || '…'
               ELSE description END AS snippet
        FROM zook_lighttick_goals
        WHERE app_id=$1 AND user_id=$2 AND status NOT IN ('archived')
        UNION ALL
        SELECT
          updated_at AS occurred_at,
          2 AS kind_rank,
          id,
          title,
          goal_id,
          status,
          CASE WHEN length(COALESCE(notes,'')) > 200
               THEN substr(notes, 1, 200) || '…'
               ELSE notes END AS snippet
        FROM zook_lighttick_tasks
        WHERE app_id=$1 AND user_id=$2 AND ${readableTask}
      )
      SELECT occurred_at, to_char(occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_occurred_at,
             kind_rank, id, title, goal_id, status, snippet
      FROM combined
      ${cursorClause}
      ORDER BY occurred_at DESC, kind_rank ASC, id COLLATE "C" DESC
      LIMIT $${values.length + 1}
    `;
    values.push(limit);
    const result = await this.query(sql, values);
    return result.rows.map(r => {
      const kind = (['record', 'goal', 'task'] as const)[Number(r.kind_rank)];
      return {
        occurred_at: toIso(r.occurred_at),
        cursor_occurred_at: String(r.cursor_occurred_at),
        kind,
        id: String(r.id),
        title: r.title ? String(r.title).slice(0, 500) : '',
        goal_id: r.goal_id ? String(r.goal_id) : undefined,
        status: r.status ? String(r.status) : undefined,
        snippet: r.snippet ? String(r.snippet).slice(0, 400) : undefined,
      };
    });
  }
}

function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return String(value);
}

export { KIND_ORDER };
