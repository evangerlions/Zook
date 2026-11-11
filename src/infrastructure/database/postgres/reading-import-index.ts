import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { ReadingImportCandidate } from "../../../modules/lighttick/reading/reading-import.types.ts";
import { readingImportURL } from "../../../modules/lighttick/reading/reading-import.types.ts";
import { fail } from "../../../modules/lighttick/learning/native-learning.validation.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export async function updateReadingImportIndex(
  query: Query,
  o: LightTickOwner,
  id: string,
  content_version: string,
  source_url: string | null,
) {
  await query(
    `INSERT INTO zook_lighttick_reading_import_index(app_id,user_id,id,url_key,content_version) VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(app_id,user_id,id) DO UPDATE SET url_key=EXCLUDED.url_key,content_version=EXCLUDED.content_version`,
    [o.appId, o.userId, id, readingImportURL(source_url), content_version],
  );
}
/** Caller holds the existing owner transaction lock; legacy payloads/hashes stay untouched. */
export async function postgresReadingImportCandidates(
  query: Query,
  o: LightTickOwner,
  url: string | null,
  version: string,
  limit: number,
  parentId?: string,
) {
  let indexed = 0;
  while (true) {
    const missing = (
      await query(
        `SELECT a.id,a.payload->>'content_version' AS content_version,a.payload->'content'->>'source_url' AS source_url
      FROM zook_lighttick_reading_articles a LEFT JOIN zook_lighttick_reading_import_index i USING(app_id,user_id,id)
      WHERE a.app_id=$1 AND a.user_id=$2 AND i.id IS NULL ORDER BY a.id COLLATE "C" LIMIT 256`,
        [o.appId, o.userId],
      )
    ).rows;
    if (!missing.length) break;
    indexed += missing.length;
    if (indexed > 10000)
      fail(
        413,
        "导入核对所需旧元数据索引超过10000篇，本次事务回滚，不返回部分候选。",
      );
    const rows = missing.map((r) => ({
      id: r.id,
      url_key: readingImportURL(r.source_url),
      content_version: r.content_version,
    }));
    await query(
      `INSERT INTO zook_lighttick_reading_import_index(app_id,user_id,id,url_key,content_version)
      SELECT $1,$2,x.id,x.url_key,x.content_version FROM jsonb_to_recordset($3::jsonb) AS x(id text,url_key text,content_version text)
      ON CONFLICT(app_id,user_id,id) DO NOTHING`,
      [o.appId, o.userId, JSON.stringify(rows)],
    );
  }
  return (
    await query(
      `SELECT jsonb_build_object('id',a.id,'revision',a.revision,'content_version',a.payload->'content_version',
    'title',a.payload->'content'->'title','source_url',a.payload->'content'->'source_url','archived',a.payload->'archived',
    'root_article_id',coalesce(a.payload->'provenance'->>'root_article_id',a.id),'parent_article_id',a.payload->'provenance'->'parent_article_id') AS value
    FROM zook_lighttick_reading_import_index i JOIN zook_lighttick_reading_articles a USING(app_id,user_id,id)
    WHERE i.app_id=$1 AND i.user_id=$2 AND (a.id=$6::text OR i.content_version=$3 OR ($4::text IS NOT NULL AND i.url_key=$4))
    ORDER BY a.id COLLATE "C" LIMIT $5`,
      [o.appId, o.userId, version, url, limit, parentId ?? null],
    )
  ).rows.map((r) => r.value as ReadingImportCandidate);
}
