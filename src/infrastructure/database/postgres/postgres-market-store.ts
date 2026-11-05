import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  MarketRepository,
  MarketWork,
  MarketSnapshot,
  MarketSnapshotSummary,
} from "../../../modules/lighttick/investments/market/market-work.types.ts";
import { marketSummary } from "../../../modules/lighttick/investments/market/market-work.types.ts";
import { decimalInput } from "../../../modules/lighttick/investments/decimal.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresMarketStore implements MarketRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string): Promise<MarketWork | undefined> {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_market_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload;
  }
  async save(w: MarketWork, base: number) {
    const args = [
      w.appId,
      w.userId,
      w.id,
      w.instrument_id,
      w.revision,
      w.status,
      w.lease_until,
      w.created_at,
      JSON.stringify(w),
    ];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_market_work VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_market_work SET revision=$5,status=$6,lease_until=$7,payload=$9::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND instrument_id=$4 AND revision=$10 AND created_at=$8 RETURNING id",
            [...args, base],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Market work changed.",
      );
  }
  async count(o: LightTickOwner, since?: string) {
    return Number(
      (
        await this.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_market_work WHERE app_id=$1 AND user_id=$2 AND ($3::timestamptz IS NULL OR created_at>=$3::timestamptz)",
          [o.appId, o.userId, since ?? null],
        )
      ).rows[0].n,
    );
  }
  async active(o: LightTickOwner, now: string) {
    return Number(
      (
        await this.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_market_work WHERE app_id=$1 AND user_id=$2 AND status='running' AND lease_until>$3::timestamptz",
          [o.appId, o.userId, now],
        )
      ).rows[0].n,
    );
  }
  async recoverable(now: string, limit: number): Promise<MarketWork[]> {
    return (
      await this.query(
        "SELECT payload FROM (SELECT payload,created_at,id,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_market_work WHERE status='queued' OR (status='running' AND lease_until<=$1::timestamptz)) candidates WHERE n<=2 ORDER BY created_at,id LIMIT $2",
        [now, limit],
      )
    ).rows.map((r) => r.payload);
  }
  async snapshot(
    o: LightTickOwner,
    id: string,
  ): Promise<MarketSnapshot | undefined> {
    const row = (
      await this.query(
        "SELECT payload FROM zook_lighttick_market_snapshots WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0];
    if (!row) return;
    const bars = (
      await this.query(
        "SELECT business_date::text AS date,open::text,high::text,low::text,close::text,volume_shares::text,amount_cny::text,turnover_rate_pct::text FROM zook_lighttick_market_bars WHERE app_id=$1 AND user_id=$2 AND snapshot_id=$3 ORDER BY business_date LIMIT 1001",
        [o.appId, o.userId, id],
      )
    ).rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).map(([k, v]) => [
          k,
          k === "date" || v === null ? v : decimalInput(v),
        ]),
      ),
    );
    return { ...row.payload, dataset: { ...row.payload.dataset, bars } };
  }
  async publish(o: LightTickOwner, s: MarketSnapshot) {
    const { bars, ...metadata } = s.dataset;
    await this.query(
      "INSERT INTO zook_lighttick_market_snapshots VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)",
      [
        o.appId,
        o.userId,
        s.id,
        s.instrument_id,
        s.work_id,
        JSON.stringify({ ...s, dataset: metadata }),
        JSON.stringify(marketSummary(s)),
      ],
    );
    await this.query(
      `INSERT INTO zook_lighttick_market_bars
      SELECT $1,$2,$3,b.date,b.open,b.high,b.low,b.close,b.volume_shares,b.amount_cny,b.turnover_rate_pct
      FROM jsonb_to_recordset($4::jsonb) AS b(date DATE,open NUMERIC,high NUMERIC,low NUMERIC,close NUMERIC,volume_shares NUMERIC,amount_cny NUMERIC,turnover_rate_pct NUMERIC)`,
      [o.appId, o.userId, s.id, JSON.stringify(bars)],
    );
  }
  async summaries(
    o: LightTickOwner,
    instrument?: string,
  ): Promise<MarketSnapshotSummary[]> {
    return (
      await this.query(
        'SELECT summary FROM zook_lighttick_market_snapshots WHERE app_id=$1 AND user_id=$2 AND ($3::text IS NULL OR instrument_id=$3) ORDER BY id COLLATE "C" LIMIT 1001',
        [o.appId, o.userId, instrument ?? null],
      )
    ).rows.map((r) => r.summary);
  }
  async works(o: LightTickOwner): Promise<MarketWork[]> {
    const bytes = Number(
      (
        await this.query(
          "SELECT COALESCE(sum(octet_length(payload::text)),0)::text AS n FROM zook_lighttick_market_work WHERE app_id=$1 AND user_id=$2",
          [o.appId, o.userId],
        )
      ).rows[0].n,
    );
    if (bytes > 8 * 1024 * 1024)
      throw new ApplicationError(
        413,
        "VALIDATION_ERROR",
        "Market receipt export exceeds capacity.",
      );
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_market_work WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 1001',
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload);
  }
}
