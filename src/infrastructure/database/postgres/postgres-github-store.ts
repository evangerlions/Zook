import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  GitHubRepository,
  GitHubState,
  GitHubTest,
} from "../../../modules/lighttick/github/github.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresGitHubStore implements GitHubRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_github_settings WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      )
    ).rows[0]?.payload as GitHubState | undefined;
  }
  async save(o: LightTickOwner, r: GitHubState, base: number) {
    const args = [o.appId, o.userId, r.revision, JSON.stringify(r)],
      result =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_github_settings VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING RETURNING revision",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_github_settings SET revision=$3,payload=$4::jsonb WHERE app_id=$1 AND user_id=$2 AND revision=$5 RETURNING revision",
              [...args, base],
            );
    if (!result.rows.length) fail(409, "GitHub settings changed.");
  }
  async test(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_github_tests WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as GitHubTest | undefined;
  }
  async saveTest(r: GitHubTest, base: number) {
    const args = [
      r.appId,
      r.userId,
      r.id,
      r.revision,
      r.status,
      r.lease_until,
      r.created_at,
      JSON.stringify(r),
    ];
    const result =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_github_tests VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_github_tests SET revision=$4,status=$5,lease_until=$6,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 AND created_at=$7 RETURNING id",
            [...args, base],
          );
    if (!result.rows.length) fail(409, "GitHub test changed.");
  }
  async active(o: LightTickOwner) {
    return (
      await this.query(
        "SELECT EXISTS(SELECT 1 FROM zook_lighttick_github_tests WHERE app_id=$1 AND user_id=$2 AND status IN ('queued','running')) AS active",
        [o.appId, o.userId],
      )
    ).rows[0].active as boolean;
  }
  async running(o: LightTickOwner, now: string) {
    return (
      await this.query(
        "SELECT count(*)::int AS n FROM zook_lighttick_github_tests WHERE app_id=$1 AND user_id=$2 AND status='running' AND lease_until>$3",
        [o.appId, o.userId, now],
      )
    ).rows[0].n as number;
  }
  async recent(o: LightTickOwner, since: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_github_tests WHERE app_id=$1 AND user_id=$2 AND created_at>=$3 ORDER BY created_at LIMIT 25",
        [o.appId, o.userId, since],
      )
    ).rows.map((r) => r.payload as GitHubTest);
  }
  async recoverable(now: string) {
    return (
      await this.query(
        `SELECT payload FROM (SELECT payload,created_at,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_github_tests WHERE status='queued' OR status='running' AND lease_until<=$1) t WHERE n=1 ORDER BY created_at LIMIT 100`,
        [now],
      )
    ).rows.map((r) => r.payload as GitHubTest);
  }
}
