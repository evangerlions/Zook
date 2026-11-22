import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  BehaviorStore,
  BehaviorRow,
  BehaviorQuery,
} from "../../../modules/lighttick/behavior/behavior.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
const table = "zook_lighttick_behavior_journal",
  where =
    " WHERE app_id=$1 AND user_id=$2 AND business_date BETWEEN $3 AND $4 AND archived=$5 AND ($6='' OR data->>'module_id'=$6) AND ($7='' OR data->>'concept'=$7) AND ($8='' OR strpos(lower(concat_ws(' ',data->>'concept',data->>'scenario')),lower($8))>0)";
export class PostgresBehaviorStore implements BehaviorStore {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        `SELECT data FROM ${table} WHERE app_id=$1 AND user_id=$2 AND id=$3`,
        [o.appId, o.userId, id],
      )
    ).rows[0]?.data as BehaviorRow | undefined;
  }
  async save(o: LightTickOwner, r: BehaviorRow, base: number) {
    const args = [
        o.appId,
        o.userId,
        r.id,
        r.version,
        r.date,
        r.archived,
        r.created_at,
        JSON.stringify(r),
      ],
      result =
        base === 0
          ? await this.query(
              `INSERT INTO ${table} VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
              args,
            )
          : await this.query(
              `UPDATE ${table} SET version=$4,business_date=$5,archived=$6,created_at=$7,data=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND version=$9 RETURNING id`,
              [...args, base],
            );
    if (!result.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "应用记录已变化。",
      );
  }
  async list(o: LightTickOwner, q: BehaviorQuery) {
    const args = [
        o.appId,
        o.userId,
        q.date_from,
        q.date_to,
        q.archived,
        q.module_id,
        q.concept,
        q.q,
      ],
      summary = (
        await this.query(
          `SELECT count(*)::int AS total,count(*) FILTER(WHERE (data->>'effectiveness')::int>0)::int AS rated_count,avg((data->>'effectiveness')::numeric) FILTER(WHERE (data->>'effectiveness')::int>0) AS effectiveness_avg FROM ${table}` +
            where,
          args,
        )
      ).rows[0],
      total = Number(summary.total),
      page = Math.min(q.page, Math.max(1, Math.ceil(total / 20))),
      rows = await this.query(
        `SELECT data FROM ${table}` +
          where +
          ' ORDER BY business_date DESC,created_at DESC,id COLLATE "C" LIMIT 20 OFFSET $9',
        [...args, (page - 1) * 20],
      );
    const modules = await this.query(
        `SELECT (data->>'module_id') COLLATE "C" AS module_id,count(*)::int AS count FROM ${table}` +
          where +
          " GROUP BY (data->>'module_id') COLLATE \"C\" ORDER BY module_id LIMIT 5001",
        args,
      ),
      concepts = await this.query(
        `SELECT (data->>'concept') COLLATE "C" AS concept,count(*)::int AS count FROM ${table}` +
          where +
          " GROUP BY (data->>'concept') COLLATE \"C\" ORDER BY count DESC,concept LIMIT 5",
        args,
      ),
      daily = await this.query(
        `SELECT business_date::text AS date,count(*)::int AS count FROM ${table}` +
          where +
          " GROUP BY business_date ORDER BY business_date",
        args,
      );
    if (modules.rows.length > 5000)
      throw new ApplicationError(
        413,
        "REQ_FIELD_INVALID",
        "模块统计超过容量，请缩小回看范围。",
      );
    return {
      items: rows.rows.map((r) => r.data as BehaviorRow),
      total,
      page,
      page_size: 20,
      stats: {
        total,
        rated_count: Number(summary.rated_count),
        effectiveness_avg:
          summary.effectiveness_avg === null
            ? null
            : Number(summary.effectiveness_avg),
        modules: modules.rows.map((r) => ({
          module_id: String(r.module_id),
          count: Number(r.count),
        })),
        concepts: concepts.rows.map((r) => ({
          concept: String(r.concept),
          count: Number(r.count),
        })),
        daily: daily.rows.map((r) => ({
          date: String(r.date),
          count: Number(r.count),
        })),
      },
    };
  }
  async concepts(o: LightTickOwner, q: string, requested: number) {
    const w =
        " WHERE app_id=$1 AND user_id=$2 AND NOT archived AND ($3='' OR strpos(lower(data->>'concept'),lower($3))>0)",
      args = [o.appId, o.userId, q],
      total = Number(
        (
          await this.query(
            `SELECT count(DISTINCT data->>'concept')::int AS total FROM ${table}` +
              w,
            args,
          )
        ).rows[0].total,
      ),
      page = Math.min(requested, Math.max(1, Math.ceil(total / 20))),
      rows = await this.query(
        `SELECT (data->>'concept') COLLATE "C" AS concept,count(*)::int AS count FROM ${table}` +
          w +
          " GROUP BY (data->>'concept') COLLATE \"C\" ORDER BY concept LIMIT 20 OFFSET $4",
        [...args, (page - 1) * 20],
      );
    return {
      items: rows.rows.map((r) => ({
        concept: String(r.concept),
        count: Number(r.count),
      })),
      total,
      page,
      page_size: 20,
    };
  }
}
