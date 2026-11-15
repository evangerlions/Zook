import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ErrorRecordsStore,
  ErrorRecord,
  ErrorCategory,
  ErrorQuery,
} from "../../../modules/lighttick/error-records/error-records.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
const conflict = () =>
  new ApplicationError(
    409,
    "LIGHTTICK_VERSION_CONFLICT",
    "错误记录或分类已变化。",
  );
const WHERE = ` WHERE app_id=$1 AND user_id=$2 AND business_date BETWEEN $3 AND $4 AND ($5='' OR data->>'module_id'=$5) AND ($6='' OR data->>'category_id'=$6) AND ($7='' OR (data->>'is_repeat')::boolean=NULLIF($7,'')::boolean) AND archived=$8 AND ($9='' OR strpos(lower(concat_ws(' ',data->>'description',data->>'context',data->>'improvement_action')),lower($9))>0)`;
export class PostgresErrorRecordsStore implements ErrorRecordsStore {
  constructor(private readonly query: Query) {}
  async lookup(o: LightTickOwner, q: string, page: number) {
    const where =
        " WHERE app_id=$1 AND user_id=$2 AND NOT archived AND ($3='' OR strpos(lower(data->>'description'),lower($3))>0)",
      args = [o.appId, o.userId, q],
      total = Number(
        (
          await this.query(
            "SELECT COUNT(*)::int AS total FROM zook_lighttick_error_records" +
              where,
            args,
          )
        ).rows[0].total,
      ),
      current = Math.min(page, Math.max(1, Math.ceil(total / 10))),
      rows = await this.query(
        "SELECT data FROM zook_lighttick_error_records" +
          where +
          ' ORDER BY business_date DESC,id COLLATE "C" LIMIT 10 OFFSET $4',
        [...args, (current - 1) * 10],
      );
    return {
      items: rows.rows.map((r) => r.data as ErrorRecord),
      total,
      page: current,
      page_size: 10,
    };
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT data FROM zook_lighttick_error_records WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.data as ErrorRecord | undefined;
  }
  async save(o: LightTickOwner, r: ErrorRecord, base: number) {
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
      res =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_error_records VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_error_records SET version=$4,business_date=$5,archived=$6,created_at=$7,data=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND version=$9 RETURNING id",
              [...args, base],
            );
    if (!res.rows.length) throw conflict();
  }
  async list(o: LightTickOwner, q: ErrorQuery) {
    const args = [
        o.appId,
        o.userId,
        q.date_from,
        q.date_to,
        q.module_id,
        q.category_id,
        q.repeat,
        q.archived,
        q.q,
      ],
      summary = (
        await this.query(
          `SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE (data->>'is_repeat')::boolean)::int AS repeated,round(avg((data->>'severity')::numeric),1) AS severity_avg FROM zook_lighttick_error_records` +
            WHERE,
          args,
        )
      ).rows[0],
      total = Number(summary.total),
      page = Math.min(q.page, Math.max(1, Math.ceil(total / q.page_size)));
    const rows = await this.query(
      "SELECT data FROM zook_lighttick_error_records" +
        WHERE +
        ' ORDER BY business_date DESC,created_at DESC,id COLLATE "C" LIMIT $10 OFFSET $11',
      [...args, q.page_size, (page - 1) * q.page_size],
    );
    const groups = await this.query(
        `SELECT (data->>'category_id') COLLATE "C" AS category_id,COUNT(*)::int AS count FROM zook_lighttick_error_records` +
          WHERE +
          ` GROUP BY (data->>'category_id') COLLATE "C" ORDER BY category_id`,
        args,
      ),
      daily = await this.query(
        "SELECT business_date::text AS date,COUNT(*)::int AS count FROM zook_lighttick_error_records" +
          WHERE +
          " GROUP BY business_date ORDER BY business_date",
        args,
      );
    const repeated = Number(summary.repeated);
    return {
      items: rows.rows.map((r) => r.data as ErrorRecord),
      total,
      page,
      page_size: q.page_size,
      filters: { ...q, page },
      stats: {
        total,
        repeated,
        repeat_rate: total
          ? Math.round((repeated / total) * 10000) / 10000
          : null,
        severity_avg:
          summary.severity_avg === null ? null : Number(summary.severity_avg),
        categories: groups.rows.map((r) => ({
          category_id: String(r.category_id),
          count: Number(r.count),
        })),
        daily: daily.rows.map((r) => ({
          date: String(r.date),
          count: Number(r.count),
        })),
      },
    };
  }
  async linked(o: LightTickOwner, id: string, after: string, limit: number) {
    const args = [o.appId, o.userId, id],
      total = Number(
        (
          await this.query(
            `SELECT COUNT(*)::int AS count FROM zook_lighttick_error_records WHERE app_id=$1 AND user_id=$2 AND data->>'related_error_id'=$3`,
            args,
          )
        ).rows[0].count,
      ),
      rows = (
        await this.query(
          `SELECT data FROM zook_lighttick_error_records WHERE app_id=$1 AND user_id=$2 AND data->>'related_error_id'=$3 AND id COLLATE "C">$4 COLLATE "C" ORDER BY id COLLATE "C" LIMIT $5`,
          [...args, after, limit + 1],
        )
      ).rows.map((r) => r.data as ErrorRecord);
    return {
      total,
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    };
  }
  async categories(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT data FROM zook_lighttick_error_categories WHERE app_id=$1 AND user_id=$2 ORDER BY id LIMIT 101",
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.data as ErrorCategory);
  }
  async saveCategory(o: LightTickOwner, r: ErrorCategory, base: number) {
    const name = r.name.normalize("NFKC").toLowerCase(),
      args = [o.appId, o.userId, r.id, r.version, name, JSON.stringify(r)],
      res =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_error_categories VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_error_categories SET version=$4,normalized_name=$5,data=$6::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND version=$7 RETURNING id",
              [...args, base],
            );
    if (!res.rows.length) throw conflict();
  }
  async deleteCategory(o: LightTickOwner, id: string, base: number) {
    const res = await this.query(
      "DELETE FROM zook_lighttick_error_categories WHERE app_id=$1 AND user_id=$2 AND id=$3 AND version=$4 RETURNING id",
      [o.appId, o.userId, id, base],
    );
    if (!res.rows.length) throw conflict();
  }
  async categoryUsage(o: LightTickOwner, id: string) {
    return Number(
      (
        await this.query(
          `SELECT COUNT(*)::int AS count FROM zook_lighttick_error_records WHERE app_id=$1 AND user_id=$2 AND data->>'category_id'=$3`,
          [o.appId, o.userId, id],
        )
      ).rows[0].count,
    );
  }
}
