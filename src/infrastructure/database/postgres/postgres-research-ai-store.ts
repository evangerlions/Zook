import type {
  ResearchAIWork,
  ResearchAIRepository,
} from "../../../modules/lighttick/investments/research-ai/research-ai.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresResearchAIStore implements ResearchAIRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_research_ai WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ResearchAIWork | undefined;
  }
  async save(w: ResearchAIWork, base: number) {
    const args = [
      w.appId,
      w.userId,
      w.id,
      w.revision,
      w.status,
      w.lease_until,
      w.created_at,
      JSON.stringify(w),
    ];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_research_ai VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_research_ai SET revision=$4,status=$5,lease_until=$6,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 AND created_at=$7 RETURNING id",
            [...args, base],
          );
    if (!r.rows.length) fail(409, "Research AI changed");
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_research_ai WHERE app_id=$1 AND user_id=$2 ORDER BY id LIMIT 201",
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload as ResearchAIWork);
  }
  async recoverable(now: string) {
    return (
      await this.query(
        "SELECT payload FROM (SELECT payload,created_at,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_research_ai WHERE status='queued' OR status='running' AND lease_until<=$1) t WHERE n=1 ORDER BY created_at LIMIT 100",
        [now],
      )
    ).rows.map((r) => r.payload as ResearchAIWork);
  }
}
