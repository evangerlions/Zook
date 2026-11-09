import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import {
  type Definition,
  type ScreenWork,
  type WorkSummary,
  type ScreeningRepository,
} from "../../../modules/lighttick/investments/screening/screen.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresScreeningStore implements ScreeningRepository {
  constructor(readonly query: Query) {}
  async definition(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    version?: number,
  ) {
    const sql =
      version === undefined
        ? "SELECT payload FROM zook_lighttick_screen_definitions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4"
        : "SELECT payload FROM zook_lighttick_screen_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision=$5";
    return (
      await this.query(sql, [
        o.appId,
        o.userId,
        kind,
        id,
        ...(version === undefined ? [] : [version]),
      ])
    ).rows[0]?.payload as Definition | undefined;
  }
  async definitions(o: LightTickOwner, kind: "rules" | "templates") {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_screen_definitions WHERE app_id=$1 AND user_id=$2 AND kind=$3 ORDER BY id COLLATE "C" LIMIT 201',
        [o.appId, o.userId, kind],
      )
    ).rows.map((r) => r.payload as Definition);
  }
  async versions(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    before: number,
    limit: number,
  ) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_screen_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision<$5 ORDER BY revision DESC LIMIT $6",
        [o.appId, o.userId, kind, id, before, limit],
      )
    ).rows.map((r) => r.payload as Definition);
  }
  async saveDefinition(o: LightTickOwner, d: Definition, base: number) {
    const args = [
        o.appId,
        o.userId,
        d.kind,
        d.id,
        d.revision,
        JSON.stringify(d),
      ],
      r =
        base === 0
          ? await this.query(
              "INSERT INTO zook_lighttick_screen_definitions VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_screen_definitions SET revision=$5,payload=$6::jsonb WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision=$7 RETURNING id",
              [...args, base],
            );
    if (!r.rows.length)
      fail(409, "Screen definition changed; retain original request.");
    await this.query(
      "INSERT INTO zook_lighttick_screen_versions VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      args,
    );
  }
  async work(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_screen_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ScreenWork | undefined;
  }
  async works(o: LightTickOwner): Promise<WorkSummary[]> {
    return (
      await this.query(
        `SELECT jsonb_build_object('id',id,'revision',revision,'status',status,'attempt',payload->'attempt','error_code',payload->'error_code','created_at',payload->'created_at','updated_at',payload->'updated_at','template_id',payload#>'{input,template,id}','template_version',payload#>'{input,template,revision}') AS payload FROM zook_lighttick_screen_work WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 101`,
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload);
  }
  async saveWork(w: ScreenWork, base: number) {
    const args = [
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
              "INSERT INTO zook_lighttick_screen_work VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_screen_work SET revision=$4,status=$5,lease_until=$6,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 AND created_at=$7 RETURNING id",
              [...args, base],
            );
    if (!r.rows.length) fail(409, "Screen task changed.");
  }
  async recoverable(now: string) {
    return (
      await this.query(
        `SELECT payload FROM (SELECT payload,created_at,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_screen_work WHERE status='queued' OR status='running' AND lease_until<=$1) q WHERE n=1 ORDER BY created_at LIMIT 100`,
        [now],
      )
    ).rows.map((r) => r.payload as ScreenWork);
  }
}
