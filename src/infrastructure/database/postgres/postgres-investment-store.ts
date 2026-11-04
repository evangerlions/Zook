import {PostgresInvestmentLedgerStore} from "./postgres-investment-ledger-store.ts";
import type {
  InvestmentAccount,
  InvestmentInstrument,
  InvestmentRepository,
} from "../../../modules/lighttick/investments/investment.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { decimalInput } from "../../../modules/lighttick/investments/decimal.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
const conflict = () => {
  throw new ApplicationError(
    409,
    "LIGHTTICK_VERSION_CONFLICT",
    "Investment data changed; retain the original request.",
  );
};
export class PostgresInvestmentStore implements InvestmentRepository {
  readonly ledger:PostgresInvestmentLedgerStore;
  constructor(readonly query: Query) {this.ledger=new PostgresInvestmentLedgerStore(query); }
  async instrument(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_instruments WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as InvestmentInstrument | undefined;
  }
  async instrumentByCode(o: LightTickOwner, market: string, code: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_instruments WHERE app_id=$1 AND user_id=$2 AND market=$3 AND code=$4",
        [o.appId, o.userId, market, code],
      )
    ).rows[0]?.payload as InvestmentInstrument | undefined;
  }
  async instruments(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_investment_instruments WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 1001',
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload as InvestmentInstrument);
  }
  async saveInstrument(
    o: LightTickOwner,
    i: InvestmentInstrument,
    base: number,
  ) {
    const args = [
        o.appId,
        o.userId,
        i.id,
        i.revision,
        i.market,
        i.code,
        JSON.stringify(i),
      ],
      result =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_investment_instruments VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_investment_instruments SET revision=$4,payload=$7::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$8 AND market=$5 AND code=$6 AND payload->>'kind'=$9 RETURNING id",
              [...args, base, i.kind],
            );
    if (!result.rows.length) conflict();
  }
  private async readAccounts(
    o: LightTickOwner,
    id?: string,
  ): Promise<InvestmentAccount[]> {
    const result = await this.query(
      `SELECT a.*,b.name,b.currency,b.baseline_date::text,b.opening_cash::text,
  COALESCE((SELECT jsonb_agg(jsonb_build_object('instrument_id',p.instrument_id,'quantity',p.quantity::text,'cost',p.cost::text) ORDER BY p.instrument_id COLLATE "C") FROM zook_lighttick_investment_openings p WHERE (p.app_id,p.user_id,p.account_id,p.baseline_version)=(a.app_id,a.user_id,a.id,a.baseline_version)),'[]'::jsonb) AS openings,
  COALESCE((SELECT jsonb_agg(i.payload ORDER BY i.id COLLATE "C") FROM zook_lighttick_investment_openings p JOIN zook_lighttick_investment_instruments i ON (i.app_id,i.user_id,i.id)=(p.app_id,p.user_id,p.instrument_id) WHERE (p.app_id,p.user_id,p.account_id,p.baseline_version)=(a.app_id,a.user_id,a.id,a.baseline_version)),'[]'::jsonb) AS opening_instruments
  FROM zook_lighttick_investment_accounts a JOIN zook_lighttick_investment_baselines b ON (b.app_id,b.user_id,b.account_id,b.version)=(a.app_id,a.user_id,a.id,a.baseline_version)
  WHERE a.app_id=$1 AND a.user_id=$2 AND ($3::text IS NULL OR a.id=$3) ORDER BY a.id COLLATE "C" LIMIT 1001`,
      [o.appId, o.userId, id ?? null],
    );
    return result.rows.map((r) => ({
      id: r.id,
      revision: r.revision,
      baseline_version: r.baseline_version,
      name: r.name,
      currency: r.currency,
      baseline_date: r.baseline_date,
      opening_cash: decimalInput(r.opening_cash),
      opening_instruments: r.opening_instruments,
      opening_positions: r.openings.map((p: any) => ({
        ...p,
        quantity: decimalInput(p.quantity, true),
        cost: p.cost === null ? null : decimalInput(p.cost),
      })),
      archived: r.archived,
      created_at: r.created_at.toISOString(),
      updated_at: r.updated_at.toISOString(),
    }));
  }
  async account(o: LightTickOwner, id: string) {
    return (await this.readAccounts(o, id))[0];
  }
  accounts(o: LightTickOwner) {
    return this.readAccounts(o);
  }
  async saveAccount(o: LightTickOwner, a: InvestmentAccount, base: number) {
    if (base === 0) {
      const inserted = await this.query(
        "INSERT INTO zook_lighttick_investment_accounts VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id",
        [
          o.appId,
          o.userId,
          a.id,
          a.revision,
          a.baseline_version,
          a.archived,
          a.created_at,
          a.updated_at,
        ],
      );
      if (!inserted.rows.length) conflict();
      await this.query(
        "INSERT INTO zook_lighttick_investment_baselines VALUES($1,$2,$3,$4,$5,$6,$7,$8::numeric)",
        [
          o.appId,
          o.userId,
          a.id,
          a.baseline_version,
          a.name,
          a.currency,
          a.baseline_date,
          a.opening_cash,
        ],
      );
      for (const p of a.opening_positions)
        await this.query(
          "INSERT INTO zook_lighttick_investment_openings VALUES($1,$2,$3,$4,$5,$6::numeric,$7::numeric)",
          [
            o.appId,
            o.userId,
            a.id,
            a.baseline_version,
            p.instrument_id,
            p.quantity,
            p.cost,
          ],
        );
    } else {
      const result = await this.query(
        "UPDATE zook_lighttick_investment_accounts SET revision=$4,archived=$5,updated_at=$6 WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$7 AND baseline_version=$8 RETURNING id",
        [
          o.appId,
          o.userId,
          a.id,
          a.revision,
          a.archived,
          a.updated_at,
          base,
          a.baseline_version,
        ],
      );
      if (!result.rows.length) conflict();
    }
  }
}
