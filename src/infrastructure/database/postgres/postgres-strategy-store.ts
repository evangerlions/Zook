import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  StrategyRepository,
  StrategyDefinition,
  BacktestWork,
  WorkSummary,
} from "../../../modules/lighttick/investments/strategies/strategy.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresStrategyStore implements StrategyRepository {
  constructor(readonly query: Query) {}
  async definition(o: LightTickOwner, id: string, version?: number) {
    const rows = await this.query(
      version === undefined
        ? "SELECT payload FROM zook_lighttick_strategy_definitions WHERE app_id=$1 AND user_id=$2 AND id=$3"
        : "SELECT payload FROM zook_lighttick_strategy_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$4",
      [o.appId, o.userId, id, ...(version === undefined ? [] : [version])],
    );
    return rows.rows[0]?.payload as StrategyDefinition | undefined;
  }
  async definitions(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_strategy_definitions WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 201',
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload as StrategyDefinition);
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_strategy_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision<$4 ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as StrategyDefinition);
  }
  async saveDefinition(o: LightTickOwner, d: StrategyDefinition, base: number) {
    const a = [o.appId, o.userId, d.id, d.revision, JSON.stringify(d)],
      r =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_strategy_definitions VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              a,
            )
          : await this.query(
              "UPDATE zook_lighttick_strategy_definitions SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",
              [...a, base],
            );
    if (!r.rows.length) fail(409, "Strategy changed.");
    await this.query(
      "INSERT INTO zook_lighttick_strategy_versions VALUES($1,$2,$3,$4,$5::jsonb)",
      a,
    );
  }
  async work(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_backtest_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as BacktestWork | undefined;
  }
  async works(o: LightTickOwner): Promise<WorkSummary[]> {
    return (
      await this.query(
        `SELECT jsonb_build_object('id',id,'sequence',payload->'sequence','revision',revision,'status',status,'attempt',payload->'attempt','error_code',payload->'error_code','created_at',payload->'created_at','updated_at',payload->'updated_at','mode',payload#>'{input,mode}','strategy_ids',jsonb_path_query_array(payload,'$.input.strategies[*].id')) AS payload FROM zook_lighttick_backtest_work WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 101`,
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload);
  }
  async saveWork(w: BacktestWork, base: number) {
    const a = [
        w.appId,
        w.userId,
        w.id,
        w.revision,
        w.status,
        w.lease_until,
        w.created_at,
        JSON.stringify(w),
      ],
      r =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_backtest_work VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              a,
            )
          : await this.query(
              "UPDATE zook_lighttick_backtest_work SET revision=$4,status=$5,lease_until=$6,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 AND created_at=$7 RETURNING id",
              [...a, base],
            );
    if (!r.rows.length) fail(409, "Backtest changed.");
  }
  async recoverable(now: string) {
    return (
      await this.query(
        `SELECT payload FROM (SELECT payload,created_at,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_backtest_work WHERE status='queued' OR status='running' AND lease_until<=$1) q WHERE n=1 ORDER BY created_at LIMIT 100`,
        [now],
      )
    ).rows.map((r) => r.payload as BacktestWork);
  }
}
