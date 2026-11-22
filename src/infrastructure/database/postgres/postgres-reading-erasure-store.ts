import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import type { ReadingArticle } from "../../../modules/lighttick/independent-reading/reading.types.ts";
import type { ReadingWork } from "../../../modules/lighttick/independent-reading/reading-work.types.ts";
import type {
  ReadingErasureRepository,
  ReadingErasureTargets,
  ReadingTombstone,
} from "../../../modules/lighttick/independent-reading/reading-erasure.types.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
const affected = `(entity_type='reading_article' AND entity_id=$3 OR entity_type='reading_work' AND entity_id=ANY($4::text[]) OR entity_type='reading_vocabulary' AND (entity_id=ANY($5::text[]) OR entity_id IN (SELECT entity_id FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type='reading_vocabulary' AND (request_payload->>'article_id'=$3 OR result_payload->'entry'->>'article_id'=$3))))`;
const args = (o: LightTickOwner, t: ReadingErasureTargets) => [
  o.appId,
  o.userId,
  t.article_id,
  t.work_ids,
  t.vocabulary_ids,
];
export class PostgresReadingErasureStore implements ReadingErasureRepository {
  constructor(readonly query: Query) {}
  async versionCount(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT count(*)::int AS n FROM zook_lighttick_independent_reading_versions WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0].n as number;
  }
  async contentTombstone(o: LightTickOwner, version: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_tombstones WHERE app_id=$1 AND user_id=$2 AND payload->>'content_version'=$3 ORDER BY payload->>'deleted_at' DESC,id LIMIT 1",
        [o.appId, o.userId, version],
      )
    ).rows[0]?.payload as ReadingTombstone | undefined;
  }
  async tombstone(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_tombstones WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingTombstone | undefined;
  }
  async related(o: LightTickOwner, a: ReadingArticle) {
    return (
      await this.query(
        `SELECT payload-'input'-'output'||jsonb_build_object('input','{}'::jsonb,'output',null) AS payload FROM zook_lighttick_reading_work WHERE app_id=$1 AND user_id=$2 AND (
   id=$3 OR payload->'input'->>'article_id'=$4 OR ($5::text IS NOT NULL AND payload->'input'->>'url'=$5) OR
   EXISTS(SELECT 1 FROM jsonb_each(payload->'adopted') AS x WHERE x.value->>'article_id'=$4) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'output'->'entry_refs','[]'::jsonb)) AS x WHERE x->>'content_digest'=$6) OR
   EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(payload->'output'->'entries','[]'::jsonb)) AS x WHERE x=$7::jsonb OR (x->>'body'=$7::jsonb->>'body' AND x->>'title'=$7::jsonb->>'title' AND x->'source_url' IS NOT DISTINCT FROM $7::jsonb->'source_url'))
  ) ORDER BY id COLLATE "C" LIMIT 101`,
        [
          o.appId,
          o.userId,
          a.provenance?.work_id ?? null,
          a.id,
          a.content.source_url,
          a.content_version,
          JSON.stringify(a.content),
        ],
      )
    ).rows.map((r) => r.payload as ReadingWork);
  }
  async receipts(o: LightTickOwner, t: ReadingErasureTargets) {
    return (
      await this.query(
        `SELECT operation_id,payload_hash FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND ${affected} ORDER BY operation_id COLLATE "C" LIMIT 10001`,
        args(o, t),
      )
    ).rows as { operation_id: string; payload_hash: string }[];
  }
  async erase(
    o: LightTickOwner,
    t: ReadingTombstone,
    targets: ReadingErasureTargets,
  ) {
    const words = (
      await this.query(
        "SELECT id,(payload->>'revision')::int AS revision FROM zook_lighttick_reading_vocabulary WHERE app_id=$1 AND user_id=$2 AND id=ANY($3::text[]) AND payload IS NOT NULL",
        [o.appId, o.userId, targets.vocabulary_ids],
      )
    ).rows;
    await this.query(
      "INSERT INTO zook_lighttick_reading_tombstones(app_id,user_id,id,payload) VALUES($1,$2,$3,$4::jsonb)",
      [o.appId, o.userId, t.id, JSON.stringify(t)],
    );
    await this.query(
      "DELETE FROM zook_lighttick_independent_reading_versions WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, t.id],
    );
    await this.query(
      "DELETE FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, t.id],
    );
    await this.query(
      "DELETE FROM zook_lighttick_reading_vocabulary_reviews WHERE app_id=$1 AND user_id=$2 AND id=ANY($3::text[])",
      [o.appId, o.userId, targets.vocabulary_ids],
    );
    await this.query(
      "UPDATE zook_lighttick_reading_vocabulary SET payload=NULL WHERE app_id=$1 AND user_id=$2 AND id=ANY($3::text[])",
      [o.appId, o.userId, targets.vocabulary_ids],
    );
    await this.query(
      "DELETE FROM zook_lighttick_reading_work_assets WHERE app_id=$1 AND user_id=$2 AND work_id=ANY($3::text[])",
      [o.appId, o.userId, targets.work_ids],
    );
    // Hash the original stored result before removing its bytes; serialization is explicit, not a request fingerprint.
    await this.query(
      `UPDATE zook_lighttick_operations SET request_payload='{}'::jsonb,result_payload=jsonb_build_object('erased',true,'entity_id',entity_id,'deleted_article_id',$3,'result_digest',encode(sha256(convert_to(result_payload::text,'UTF8')),'hex'),'digest_version','postgres-jsonb-text-sha256-v1'),updated_at=$6 WHERE app_id=$1 AND user_id=$2 AND ${affected} AND result_payload->>'erased' IS DISTINCT FROM 'true'`,
      [...args(o, targets), t.deleted_at],
    );
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: "article",
      id: t.id,
      revision: t.revision,
      operation: "delete",
    });
    for (const word of words)
      await appendDomainChange(this.query, o, {
        domain: "reading",
        resource: "vocabulary",
        id: word.id,
        revision: word.revision,
        operation: "delete",
      });
  }
}
