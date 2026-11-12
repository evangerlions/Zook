import { defaultErrorTypes } from "../../../modules/lighttick/experience/experience-catalog.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ExperienceKind,
  ExperienceObject,
  ExperienceTombstone,
  ExperienceQuery,
  ExperienceSummary,
  ExperienceRepository,
  ExperienceAggregate,
  ExperienceRepeated,
  ExperienceScope,
  ExperienceSection,
  ExperienceExportRecord,
} from "../../../modules/lighttick/experience/experience.types.ts";
import {
  experienceWhere,
  EXPERIENCE_OBJECTS,
  EXPERIENCE_SUMMARY_SQL,
} from "./experience-query.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import { postgresExperienceAggregate } from "./postgres-experience-statistics.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresExperienceStore implements ExperienceRepository {
  constructor(readonly query: Query) {}
  async entries(
    o: LightTickOwner,
    section: ExperienceSection,
    after: string,
    limit: number,
  ): Promise<ExperienceExportRecord[]> {
    if (section === "receipts")
      return (
        await this.query(
          "SELECT operation_id AS key,to_jsonb(r)-'app_id'-'user_id' AS value FROM zook_lighttick_operations r WHERE app_id=$1 AND user_id=$2 AND entity_type='experience' AND operation_id COLLATE \"C\">$3 ORDER BY operation_id COLLATE \"C\" LIMIT $4",
          [o.appId, o.userId, after, limit],
        )
      ).rows as ExperienceExportRecord[];
    const table =
        section === "objects"
          ? "experience"
          : section === "versions"
            ? "experience_versions"
            : "experience_tombstones",
      key =
        section === "versions"
          ? "jsonb_build_array(kind,id,revision)::text"
          : "jsonb_build_array(kind,id)::text";
    return (
      await this.query(
        `SELECT ${key} AS key,payload AS value FROM zook_lighttick_${table} WHERE app_id=$1 AND user_id=$2 AND (${key}) COLLATE "C">$3 ORDER BY (${key}) COLLATE "C" LIMIT $4`,
        [o.appId, o.userId, after, limit],
      )
    ).rows as ExperienceExportRecord[];
  }
  async get(o: LightTickOwner, kind: ExperienceKind, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_experience WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4",
        [o.appId, o.userId, kind, id],
      )
    ).rows[0]?.payload as ExperienceObject | undefined;
  }
  async tombstone(o: LightTickOwner, kind: ExperienceKind, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_experience_tombstones WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4",
        [o.appId, o.userId, kind, id],
      )
    ).rows[0]?.payload as ExperienceTombstone | undefined;
  }
  async save(o: LightTickOwner, row: ExperienceObject, base: number) {
    const args = [
      o.appId,
      o.userId,
      row.kind,
      row.id,
      row.revision,
      JSON.stringify(row),
    ];
    const saved =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_experience(app_id,user_id,kind,id,revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_experience SET revision=$5,payload=$6::jsonb WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision=$7 RETURNING id",
            [...args, base],
          );
    if (!saved.rows.length) fail(409, "记录已变化，请保留本机输入核对。");
    await this.query(
      "INSERT INTO zook_lighttick_experience_versions(app_id,user_id,kind,id,revision,payload) VALUES($1,$2,$3,$4,$5,$6::jsonb)",
      args,
    );
    await appendDomainChange(this.query, o, {
      domain: "experience",
      resource: row.kind,
      id: row.id,
      revision: row.revision,
      operation: "upsert",
    });
  }
  async page(
    o: LightTickOwner,
    q: ExperienceQuery,
  ): Promise<ExperienceSummary[]> {
    const w = experienceWhere(o, q);
    if (q.after) {
      const id = w.bind(q.after.id);
      if (q.after.date === null)
        w.conditions.push(
          "r.payload->'data'->>'date' IS NULL AND r.id COLLATE \"C\"<" + id,
        );
      else {
        const dt = w.bind(q.after.date);
        w.conditions.push(
          `(r.payload->'data'->>'date'<${dt} OR (r.payload->'data'->>'date'=${dt} AND r.id COLLATE "C"<${id}) OR r.payload->'data'->>'date' IS NULL)`,
        );
      }
    }
    const limit = w.bind(q.limit);
    return (
      await this.query(
        `SELECT ${EXPERIENCE_SUMMARY_SQL} AS summary FROM ${EXPERIENCE_OBJECTS} WHERE ${w.where()} ORDER BY (r.payload->'data'->>'date') DESC NULLS LAST,r.id COLLATE "C" DESC LIMIT ${limit}`,
        w.args,
      )
    ).rows.map((r) => r.summary);
  }
  async history(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    before: number,
    limit: number,
  ) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_experience_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4 AND revision<$5::bigint ORDER BY revision DESC LIMIT $6",
        [o.appId, o.userId, kind, id, before, limit],
      )
    ).rows.map((r) => r.payload as ExperienceObject);
  }
  async typeNameUsed(o: LightTickOwner, name: string, except: string) {
    const q: ExperienceQuery = {
        kind: "error_type",
        archived: "active",
        date_from: null,
        date_to: null,
        module_id: null,
        error_type: null,
        is_repeat: null,
        search: "",
        after: null,
        limit: 1,
      },
      w = experienceWhere(o, q);
    w.conditions.push(
      "r.id<>" + w.bind(except),
      "r.payload->'data'->>'name'=" + w.bind(name),
    );
    return (
      (
        await this.query(
          `SELECT 1 FROM ${EXPERIENCE_OBJECTS} WHERE ${w.where()} LIMIT 1`,
          w.args,
        )
      ).rows.length > 0
    );
  }
  async scope(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
  ): Promise<ExperienceScope> {
    const args = [o.appId, o.userId, kind, id];
    const versions = Number(
      (
        await this.query(
          "SELECT count(*)::int AS n FROM zook_lighttick_experience_versions WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4",
          args,
        )
      ).rows[0].n,
    );
    const references = Number(
      (
        await this.query(
          `SELECT count(*)::int AS n FROM zook_lighttick_experience WHERE app_id=$1 AND user_id=$2 AND kind='error' AND (( $3='error' AND payload->'data'->>'related_error_id'=$4) OR ($3='error_type' AND (payload->'data'->>'type_id'=$4 OR (payload->'data'->>'type_id' IS NULL AND payload->'data'->>'error_type'=coalesce((SELECT x.payload->'data'->>'name' FROM zook_lighttick_experience x WHERE x.app_id=$1 AND x.user_id=$2 AND x.kind='error_type' AND x.id=$4),$5)))))`,
          [
            ...args,
            (
              defaultErrorTypes.find((r) => r.id === id)?.data as
                | { name: string }
                | undefined
            )?.name ?? null,
          ],
        )
      ).rows[0].n,
    );
    const receipts = (
      await this.query(
        "SELECT operation_id AS key,payload_hash AS hash FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type='experience' AND entity_id=$3 ORDER BY operation_id COLLATE \"C\" LIMIT 10001",
        [o.appId, o.userId, id],
      )
    ).rows as { key: string; hash: string }[];
    return { versions, references, receipts };
  }
  async erase(o: LightTickOwner, t: ExperienceTombstone) {
    await this.query(
      "INSERT INTO zook_lighttick_experience_tombstones(app_id,user_id,kind,id,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      [o.appId, o.userId, t.kind, t.id, JSON.stringify(t)],
    );
    await this.query(
      "DELETE FROM zook_lighttick_experience WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4",
      [o.appId, o.userId, t.kind, t.id],
    );
    await this.query(
      "UPDATE zook_lighttick_operations SET request_payload='{}'::jsonb,result_payload=jsonb_build_object('erased',true,'id',entity_id,'result_digest',encode(sha256(convert_to(result_payload::text,'UTF8')),'hex'),'digest_version','postgres-jsonb-text-sha256-v1'),updated_at=$4::timestamptz WHERE app_id=$1 AND user_id=$2 AND entity_type='experience' AND entity_id=$3 AND result_payload->>'erased' IS DISTINCT FROM 'true'",
      [o.appId, o.userId, t.id, t.deleted_at],
    );
    await appendDomainChange(this.query, o, {
      domain: "experience",
      resource: t.kind,
      id: t.id,
      revision: t.revision,
      operation: "delete",
    });
  }
  aggregate(
    o: LightTickOwner,
    q: ExperienceQuery,
    start: string,
    end: string,
  ): Promise<ExperienceAggregate[]> {
    return postgresExperienceAggregate(this.query, o, q, start, end);
  }
  async repeated(
    o: LightTickOwner,
    q: ExperienceQuery,
  ): Promise<ExperienceRepeated[]> {
    const w = experienceWhere(o, q),
      having = ["count(*)>=2"];
    if (q.after)
      having.push(
        `(count(*)<${w.bind(q.after.count)} OR (count(*)=${w.bind(q.after.count)} AND (r.payload->'data'->>'error_type') COLLATE "C">${w.bind(q.after.id)}))`,
      );
    const limit = w.bind(q.limit);
    return (
      await this.query(
        `SELECT (r.payload->'data'->>'error_type') COLLATE \"C\" AS error_type,count(*)::int AS count,min(r.payload->'data'->>'date') AS first_occurrence,max(r.payload->'data'->>'date') AS last_occurrence,count(*) FILTER(WHERE r.payload->'data'->>'date' IS NULL)::int AS unknown_dates FROM ${EXPERIENCE_OBJECTS} WHERE ${w.where()} GROUP BY (r.payload->'data'->>'error_type') COLLATE \"C\" HAVING ${having.join(" AND ")} ORDER BY count(*) DESC,(r.payload->'data'->>'error_type') COLLATE "C" ASC LIMIT ${limit}`,
        w.args,
      )
    ).rows as ExperienceRepeated[];
  }
  async concepts(o: LightTickOwner, after: string, limit: number) {
    return (
      await this.query(
        `SELECT DISTINCT (payload->'data'->>'concept') COLLATE "C" AS concept FROM zook_lighttick_experience WHERE app_id=$1 AND user_id=$2 AND kind='application' AND payload->>'archived'='false' AND (payload->'data'->>'concept') COLLATE "C">$3 ORDER BY concept LIMIT $4`,
        [o.appId, o.userId, after, limit],
      )
    ).rows.map((r) => r.concept as string);
  }
}
