import type {
  JournalRepository,
  JournalState,
} from "../../../modules/lighttick/investments/journal/journal.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresInvestmentJournalStore implements JournalRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_investment_journal WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.payload as JournalState | undefined;
  }
  async save(o: LightTickOwner, s: JournalState, base: number) {
    const args = [o.appId, o.userId, s.revision, JSON.stringify(s)];
    const result =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_investment_journal(app_id,user_id,revision,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING user_id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_investment_journal SET revision=$3,payload=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND revision=$5 RETURNING user_id",
            [...args, base],
          );
    if (!result.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Investment journal changed.",
      );
  }
}
