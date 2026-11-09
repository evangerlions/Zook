import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import {
  type Observation,
  type ObservationKind,
  type MonitorRuntime,
  type ObservationWork,
  type WorkSummary,
  type ObservationStore,
} from "../../../modules/lighttick/investments/observations/observation.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresObservationStore implements ObservationStore {
  constructor(readonly query: Query) {}
  async get(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    version?: number,
  ) {
    const sql =
      version === undefined
        ? "SELECT payload FROM zook_lighttick_observations WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4"
        : "SELECT payload FROM zook_lighttick_observation_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision=$5";
    return (
      await this.query(sql, [
        o.appId,
        o.userId,
        kind,
        id,
        ...(version === undefined ? [] : [version]),
      ])
    ).rows[0]?.payload as Observation | undefined;
  }
  async list(o: LightTickOwner, kind: ObservationKind) {
    return (
      await this.query(
        `SELECT payload - 'frozen' AS payload FROM zook_lighttick_observations WHERE app_id=$1 AND user_id=$2 AND kind=$3 ORDER BY id COLLATE "C" LIMIT 1001`,
        [o.appId, o.userId, kind],
      )
    ).rows.map((r) => r.payload as Observation);
  }
  async versions(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    before: number,
    limit: number,
    viewOnly = false,
  ) {
    return (
      await this.query(
        "SELECT " +
          (viewOnly ? "payload - 'frozen'" : "payload") +
          " AS payload FROM zook_lighttick_observation_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision<$5 ORDER BY revision DESC LIMIT $6",
        [o.appId, o.userId, kind, id, before, limit],
      )
    ).rows.map((r) => r.payload as Observation);
  }
  async save(o: LightTickOwner, d: Observation, base: number) {
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
              "INSERT INTO zook_lighttick_observations VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_observations SET revision=$5,payload=$6::jsonb WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision=$7 RETURNING id",
              [...args, base],
            );
    if (!r.rows.length)
      fail(409, "Observation changed; retain original request.");
    await this.query(
      "INSERT INTO zook_lighttick_observation_versions VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      args,
    );
  }
  async work(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_observation_work WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ObservationWork | undefined;
  }
  async works(o: LightTickOwner): Promise<WorkSummary[]> {
    return (
      await this.query(
        `SELECT jsonb_build_object('id',id,'sequence',payload->'sequence','revision',revision,'status',status,'kind',payload->'kind','resource_id',payload->'resource_id','attempt',payload->'attempt','error_code',payload->'error_code','created_at',payload->'created_at','updated_at',payload->'updated_at') AS payload FROM zook_lighttick_observation_work WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 301`,
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload);
  }
  async calibrationRows(o: LightTickOwner) {
    return (
      await this.query(
        `SELECT jsonb_build_object('prediction_id',payload->'resource_id','probability',payload#>'{input,prediction,fields,probability}','as_of',payload#>'{input,as_of}','decision_at',payload#>'{input,decision_at}','sequence',payload->'sequence','outcomes',payload#>'{output,outcomes}') AS payload FROM zook_lighttick_observation_work WHERE app_id=$1 AND user_id=$2 AND status='succeeded' AND payload->>'kind'='evaluation' LIMIT 301`,
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload);
  }
  async updateRuntime(o: LightTickOwner, id: string, runtime: MonitorRuntime) {
    await this.query(
      "UPDATE zook_lighttick_observations SET payload=jsonb_set(payload,'{runtime}',$4::jsonb) WHERE app_id=$1 AND user_id=$2 AND kind='monitors' AND id=$3",
      [o.appId, o.userId, id, JSON.stringify(runtime)],
    );
  }
  async due(now: string) {
    return (
      await this.query(
        `SELECT app_id AS "appId",user_id AS "userId",id FROM (SELECT *,row_number() OVER(PARTITION BY app_id,user_id ORDER BY payload#>>'{runtime,next_at}',id) AS n FROM zook_lighttick_observations WHERE kind='monitors' AND payload->>'archived'='false' AND payload#>>'{fields,enabled}'='true' AND payload#>>'{runtime,next_at}'<=$1) q WHERE n<=2 ORDER BY payload#>>'{runtime,next_at}',id LIMIT 100`,
        [now],
      )
    ).rows as (LightTickOwner & { id: string })[];
  }
  async saveWork(w: ObservationWork, base: number) {
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
              "INSERT INTO zook_lighttick_observation_work VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",
              args,
            )
          : await this.query(
              "UPDATE zook_lighttick_observation_work SET revision=$4,status=$5,lease_until=$6,payload=$8::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$9 AND created_at=$7 RETURNING id",
              [...args, base],
            );
    if (!r.rows.length) fail(409, "Observation work changed.");
  }
  async recoverable(now: string) {
    return (
      await this.query(
        `SELECT payload FROM (SELECT payload,created_at,row_number() OVER(PARTITION BY app_id,user_id ORDER BY created_at,id) AS n FROM zook_lighttick_observation_work WHERE status='queued' OR status='running' AND lease_until<=$1) q WHERE n=1 ORDER BY created_at LIMIT 100`,
        [now],
      )
    ).rows.map((r) => r.payload as ObservationWork);
  }
}
