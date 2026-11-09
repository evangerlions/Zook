import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import {
  researchSummary,
  type ResearchEntry,
  type ResearchRepository,
} from "../../../modules/lighttick/investments/research/research.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresResearchStore implements ResearchRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_research WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ResearchEntry | undefined;
  }
  async list(o: LightTickOwner, instrument?: string) {
    return (
      await this.query(
        `SELECT payload - ARRAY['market_context','technical_case','catalyst','company_risk','valuation_assumptions','liquidity','nav_context','portfolio_impact','contrary_case','missing_inputs','evidence','market_sources'] AS payload FROM zook_lighttick_investment_research WHERE app_id=$1 AND user_id=$2 AND ($3::text IS NULL OR instrument_id=$3) ORDER BY id COLLATE "C" LIMIT 501`,
        [o.appId, o.userId, instrument ?? null],
      )
    ).rows.map((r) => researchSummary(r.payload));
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_research_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision<$4 ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as ResearchEntry);
  }
  async save(o: LightTickOwner, e: ResearchEntry, base: number) {
    const args = [
      o.appId,
      o.userId,
      e.id,
      e.instrument_id,
      e.account_id,
      e.revision,
      JSON.stringify(e),
    ];
    const result =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_investment_research VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_investment_research SET account_id=$5,revision=$6,payload=$7::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND instrument_id=$4 AND revision=$8 RETURNING id",
            [...args, base],
          );
    if (!result.rows.length)
      fail(409, "Research changed; retain the original request.");
    await this.query(
      "INSERT INTO zook_lighttick_investment_research_versions VALUES($1,$2,$3,$4,$5::jsonb)",
      [o.appId, o.userId, e.id, e.revision, JSON.stringify(e)],
    );
  }
}
