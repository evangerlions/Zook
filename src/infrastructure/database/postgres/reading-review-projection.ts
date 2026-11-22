import { READING_SEARCH_SQL } from "./reading-search-query.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { ReadingReviewProjection } from "../../../modules/lighttick/independent-reading/reading-review-projection.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
/** Match the complete private source in SQL, transferring only a real bounded context. */
export async function postgresReadingReviewProjection(
  query: Query,
  o: LightTickOwner,
  search: string,
  limit: number,
): Promise<ReadingReviewProjection[]> {
  return (
    await query(
      `SELECT id,revision,payload->>'content_version' AS content_version,payload->'content'->>'title' AS title,CASE WHEN $3='' THEN left(payload->'content'->>'body',500) ELSE substring(search_text FROM greatest(1,strpos(lower(search_text),lower($3))-100) FOR 500) END AS excerpt,payload->>'created_at' AS created_at,(payload->'personal'->>'read')::boolean AS read,payload->'personal'->>'read_at' AS read_at FROM (SELECT id,revision,payload,CASE WHEN $3='' THEN '' ELSE ${READING_SEARCH_SQL} END AS search_text FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2) AS r WHERE $3='' OR search_text ILIKE $4 ORDER BY id COLLATE "C" LIMIT $5`,
      [
        o.appId,
        o.userId,
        search,
        "%" + search.replace(/[\\%_]/g, "\\$&") + "%",
        limit,
      ],
    )
  ).rows as ReadingReviewProjection[];
}
