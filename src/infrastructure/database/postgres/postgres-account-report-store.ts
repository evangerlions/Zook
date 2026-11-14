import type {
  AccountReportSummary,
  AccountReportRepository,
  AccountReportRow,
} from "../../../modules/lighttick/account-reports/account-report.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresAccountReportStore implements AccountReportRepository {
  constructor(private readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    const r = await this.query(
      "SELECT data FROM zook_lighttick_account_reports WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
    return r.rows[0]?.data as AccountReportRow | undefined;
  }
  async save(row: AccountReportRow, base: number) {
    const r =
      base === 0
        ? await this.query(
            `INSERT INTO zook_lighttick_account_reports(app_id,user_id,id,revision,status,lease_until,created_at,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id`,
            [
              row.appId,
              row.userId,
              row.id,
              row.revision,
              row.status,
              row.lease_until,
              row.created_at,
              JSON.stringify(row),
            ],
          )
        : await this.query(
            `UPDATE zook_lighttick_account_reports SET revision=$4,status=$5,lease_until=$6,data=$7::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$8 RETURNING id`,
            [
              row.appId,
              row.userId,
              row.id,
              row.revision,
              row.status,
              row.lease_until,
              JSON.stringify(row),
              base,
            ],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "报告已变化。",
      );
  }
  async list(o: LightTickOwner, offset: number, limit: number) {
    const r = await this.query(
      `SELECT (data - 'facts' - 'output' - 'model_selection' - 'fence' - 'lease_until' - 'request_hash' - 'appId' - 'userId') || jsonb_build_object('period_start',data->'facts'->'start','period_end',data->'facts'->'end','timezone',data->'facts'->'timezone','active_days',data->'facts'->'active_days') AS summary FROM zook_lighttick_account_reports WHERE app_id=$1 AND user_id=$2 AND status<>'deleted' ORDER BY created_at DESC,id ASC OFFSET $3 LIMIT $4`,
      [o.appId, o.userId, offset, limit],
    );
    const count = await this.query(
      `SELECT count(*)::int AS total FROM zook_lighttick_account_reports WHERE app_id=$1 AND user_id=$2 AND status<>'deleted'`,
      [o.appId, o.userId],
    );
    return {
      items: r.rows.map((r) => r.summary as AccountReportSummary),
      total: Number(count.rows[0].total),
    };
  }
  async recoverable(now: string) {
    const r = await this.query(
      `SELECT data FROM zook_lighttick_account_reports WHERE status='queued' OR (status='running' AND lease_until<=$1) ORDER BY created_at,id LIMIT 100`,
      [now],
    );
    return r.rows.map((r) => r.data as AccountReportRow);
  }
}
