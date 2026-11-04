import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  LedgerEvent,
  LedgerWork,
  InvestmentLedgerRepository,
  LedgerInput,
} from "../../../modules/lighttick/investments/ledger.types.ts";
import { decimalInput } from "../../../modules/lighttick/investments/decimal.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresInvestmentLedgerStore
  implements InvestmentLedgerRepository
{
  constructor(readonly query: Query) {}
  async events(o: LightTickOwner, account: string): Promise<LedgerEvent[]> {
    const rows = (
      await this.query(
        "SELECT *,price::text,quantity::text,fee::text,tax::text,settlement_amount::text,amount::text,business_date::text FROM zook_lighttick_investment_events WHERE app_id=$1 AND user_id=$2 AND account_id=$3 ORDER BY zook_lighttick_investment_events.business_date,sequence LIMIT 10001",
        [o.appId, o.userId, account],
      )
    ).rows;
    const d = (v: any) => (v === null ? null : decimalInput(v));
    return rows.map((r) => ({
      id: r.id,
      account_id: r.account_id,
      sequence: r.sequence,
      created_at: r.created_at.toISOString(),
      input: {
        business_date: r.business_date,
        ...(r.kind === "fill"
          ? {
              kind: "fill",
              fill: {
                instrument_id: r.instrument_id,
                side: r.side,
                price: d(r.price)!,
                quantity: d(r.quantity)!,
                fee: d(r.fee),
                tax: d(r.tax),
                source: r.source,
                settlement_amount: d(r.settlement_amount),
              },
            }
          : {
              kind: "cash",
              cash: { kind: r.cash_kind, amount: d(r.amount)! },
            }),
      } as LedgerInput,
    }));
  }
  async append(o: LightTickOwner, e: LedgerEvent) {
    const i = e.input,
      f = i.kind === "fill" ? i.fill : null,
      c = i.kind === "cash" ? i.cash : null;
    await this.query(
      "INSERT INTO zook_lighttick_investment_events VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::numeric,$12::numeric,$13::numeric,$14::numeric,$15::numeric,$16::numeric,$17,$18)",
      [
        o.appId,
        o.userId,
        e.account_id,
        e.id,
        e.sequence,
        i.business_date,
        i.kind,
        f?.instrument_id ?? null,
        f?.side ?? null,
        c?.kind ?? null,
        f?.price ?? null,
        f?.quantity ?? null,
        f?.fee ?? null,
        f?.tax ?? null,
        f?.settlement_amount ?? null,
        c?.amount ?? null,
        f?.source ?? null,
        e.created_at,
      ],
    );
  }
  async get(o: LightTickOwner, id: string): Promise<LedgerWork | undefined> {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_ledger_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload;
  }
  async save(r: LedgerWork, base: number) {
    const args = [
        r.appId,
        r.userId,
        r.id,
        r.account_id,
        r.revision,
        r.status,
        r.lease_until,
        JSON.stringify(r),
      ],
      result =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_investment_ledger_work VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_investment_ledger_work SET revision=$5,status=$6,lease_until=$7,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND account_id=$4 AND revision=$9 RETURNING id",
              [...args, base],
            );
    if (!result.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Ledger work changed.",
      );
  }
  async count(o: LightTickOwner, account: string) {
    return Number(
      (
        await this.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_investment_ledger_work WHERE app_id=$1 AND user_id=$2 AND account_id=$3",
          [o.appId, o.userId, account],
        )
      ).rows[0].n,
    );
  }
  async latest(o: LightTickOwner, account: string) {
    return (
      (
        await this.query(
          "SELECT payload->'output' AS output FROM zook_lighttick_investment_ledger_work WHERE app_id=$1 AND user_id=$2 AND account_id=$3 AND status='succeeded' ORDER BY (payload->'output'->>'account_revision')::integer DESC LIMIT 1",
          [o.appId, o.userId, account],
        )
      ).rows[0]?.output ?? null
    );
  }
  async list(o: LightTickOwner, id: string): Promise<LedgerWork[]> {
    const bytes=Number((await this.query('SELECT COALESCE(sum(octet_length(payload::text)),0)::text AS bytes FROM zook_lighttick_investment_ledger_work WHERE app_id=$1 AND user_id=$2 AND account_id=$3',[o.appId,o.userId,id])).rows[0].bytes);
    if(bytes>8*1024*1024)throw new ApplicationError(413,'VALIDATION_ERROR','Ledger receipt export exceeds 8 MiB.');
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_investment_ledger_work WHERE app_id=$1 AND user_id=$2 AND account_id=$3 ORDER BY id COLLATE "C" LIMIT 1001',
        [o.appId, o.userId, id],
      )
    ).rows.map((r) => r.payload);
  }
  async recoverable(now: string, limit: number): Promise<LedgerWork[]> {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_ledger_work WHERE status='queued' OR (status='running' AND lease_until<=$1::timestamptz) ORDER BY id COLLATE \"C\" LIMIT $2",
        [now, limit],
      )
    ).rows.map((r) => r.payload);
  }
}
