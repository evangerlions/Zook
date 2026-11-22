import { READING_SEARCH_SQL } from "./reading-search-query.ts";
import { appendDomainChange } from "./postgres-domain-changes-store.ts";
import {
  postgresReadingImportCandidates,
  updateReadingImportIndex,
} from "./reading-import-index.ts";
import { postgresReadingReviewProjection } from "./reading-review-projection.ts";
import { READING_CATALOG_SQL } from "./reading-catalog-projection.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ReadingCatalogEntry,
  ReadingRepository,
  ReadingArticle,
  ArticleQuery,
} from "../../../modules/lighttick/independent-reading/reading.types.ts";
import type {
  VocabularyEntry,
  VocabularyReview,
  VocabularyQuery,
} from "../../../modules/lighttick/independent-reading/vocabulary.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresIndependentReadingStore implements ReadingRepository {
  constructor(readonly query: Query) {}
  async importCandidates(
    o: LightTickOwner,
    url: string | null,
    version: string,
    limit: number,
    parentId?: string,
  ) {
    return postgresReadingImportCandidates(
      this.query,
      o,
      url,
      version,
      limit,
      parentId,
    );
  }
  async getVocabulary(o: LightTickOwner, id: string) {
    const row = (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_vocabulary WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0];
    return (row?.payload ?? undefined) as VocabularyEntry | undefined;
  }
  async duplicateVocabulary(
    o: LightTickOwner,
    article: string,
    normalized: string,
  ) {
    return (
      (
        await this.query(
          "SELECT id FROM zook_lighttick_reading_vocabulary WHERE app_id=$1 AND user_id=$2 AND payload->>'article_id'=$3 AND payload->>'normalized'=$4 AND payload IS NOT NULL LIMIT 1",
          [o.appId, o.userId, article, normalized],
        )
      ).rows.length > 0
    );
  }
  async vocabularyPage(o: LightTickOwner, q: VocabularyQuery) {
    const active =
      "NOT (payload->>'paused')::boolean AND NOT (payload->>'archived')::boolean";
    const due = active + " AND payload->>'next_review'<=$4";
    const where =
      "app_id=$1 AND user_id=$2 AND payload IS NOT NULL AND ($3='' OR payload->>'article_id'=$3)";
    const args = [o.appId, o.userId, q.article_id, q.today];
    const statsRow = (
      await this.query(
        `SELECT count(*)::int AS total,count(*) FILTER(WHERE ${active})::int AS active,count(*) FILTER(WHERE (payload->>'paused')::boolean)::int AS paused,count(*) FILTER(WHERE (payload->>'archived')::boolean)::int AS archived,count(*) FILTER(WHERE ${due})::int AS due FROM zook_lighttick_reading_vocabulary WHERE ${where}`,
        args,
      )
    ).rows[0];
    const filter =
      q.filter === "due"
        ? due
        : q.filter === "paused"
          ? "(payload->>'paused')::boolean AND NOT (payload->>'archived')::boolean"
          : q.filter === "archived"
            ? "(payload->>'archived')::boolean"
            : q.filter === "all"
              ? "true"
              : "NOT (payload->>'archived')::boolean";
    const cursor =
      q.filter === "due"
        ? `((payload->>'next_review') COLLATE "C">$6 OR ((payload->>'next_review')=$6 AND id COLLATE "C">$5))`
        : `id COLLATE "C">$5 AND $6::text IS NOT NULL`;
    const order =
      q.filter === "due"
        ? `(payload->>'next_review') COLLATE "C",id COLLATE "C"`
        : `id COLLATE "C"`;
    const items = (
      await this.query(
        `SELECT payload FROM zook_lighttick_reading_vocabulary WHERE ${where} AND (${filter}) AND (${cursor}) AND $4::text IS NOT NULL ORDER BY ${order} LIMIT $7`,
        [...args, q.after_id, q.after_date, q.limit],
      )
    ).rows.map((r) => r.payload as VocabularyEntry);
    return {
      items,
      stats:
        statsRow as unknown as import("../../../modules/lighttick/independent-reading/vocabulary.types.ts").VocabularyStats,
    };
  }
  async vocabularyIdUsed(o: LightTickOwner, id: string) {
    return (
      (
        await this.query(
          "SELECT id FROM zook_lighttick_reading_vocabulary WHERE app_id=$1 AND user_id=$2 AND id=$3",
          [o.appId, o.userId, id],
        )
      ).rows.length > 0
    );
  }
  async listVocabulary(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_reading_vocabulary WHERE app_id=$1 AND user_id=$2 AND payload IS NOT NULL ORDER BY id COLLATE "C"',
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload as VocabularyEntry);
  }
  async listVocabularyReviews(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_vocabulary_reviews WHERE app_id=$1 AND user_id=$2 AND id=$3 ORDER BY revision",
        [o.appId, o.userId, id],
      )
    ).rows.map((r) => r.payload as VocabularyReview);
  }
  async saveVocabulary(
    o: LightTickOwner,
    entry: VocabularyEntry,
    review?: VocabularyReview,
  ) {
    await this.query(
      "INSERT INTO zook_lighttick_reading_vocabulary(app_id,user_id,id,payload) VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(app_id,user_id,id) DO UPDATE SET payload=EXCLUDED.payload",
      [o.appId, o.userId, entry.id, JSON.stringify(entry)],
    );
    if (review)
      await this.query(
        "INSERT INTO zook_lighttick_reading_vocabulary_reviews(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
        [o.appId, o.userId, entry.id, entry.revision, JSON.stringify(review)],
      );
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: "vocabulary",
      id: entry.id,
      revision: entry.revision,
      operation: "upsert",
    });
  }
  async deleteVocabulary(o: LightTickOwner, id: string) {
    const prior = await this.getVocabulary(o, id);
    await this.query(
      "DELETE FROM zook_lighttick_reading_vocabulary_reviews WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
    await this.query(
      "UPDATE zook_lighttick_reading_vocabulary SET payload=NULL WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
    if (prior)
      await appendDomainChange(this.query, o, {
        domain: "reading",
        resource: "vocabulary",
        id,
        revision: prior.revision,
        operation: "delete",
      });
  }
  async recommendationHistory(o: LightTickOwner) {
    return (
      await this.query(
        `SELECT payload->'content'->>'source_url' AS source_url,coalesce(payload->'content'->'topics','[]'::jsonb) AS topics,payload->'personal'->'structured_feedback'->>'value' AS feedback_value,payload->>'created_at' AS saved_at FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 10001`,
        [o.appId, o.userId],
      )
    )
      .rows as import("../../../modules/lighttick/independent-reading/reading-recommendation.ts").ReadingRecommendationHistory[];
  }
  async reference(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT jsonb_build_object('id',id,'content_version',payload->'content_version','archived',payload->'archived') AS payload FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as
      | Pick<ReadingArticle, "id" | "content_version" | "archived">
      | undefined;
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingArticle | undefined;
  }
  async reviewProjection(o: LightTickOwner, query: string, limit: number) {
    return postgresReadingReviewProjection(this.query, o, query, limit);
  }
  async list(o: LightTickOwner, q: ArticleQuery) {
    return this.page<ReadingArticle>(o, q, "payload");
  }
  async catalog(o: LightTickOwner, q: ArticleQuery) {
    return this.page<ReadingCatalogEntry>(o, q, READING_CATALOG_SQL);
  }
  private async page<T>(
    o: LightTickOwner,
    q: ArticleQuery,
    projection: string,
  ) {
    const search = q.search.replace(/[\\%_]/g, "\\$&");
    return (
      await this.query(
        `SELECT ${projection} AS payload FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND (payload->>'archived')::boolean=$4 AND
      ($5='%%' OR ${READING_SEARCH_SQL} ILIKE $5) AND
      ($6 NOT IN ('bookmark','later','read','feedback') OR CASE WHEN $6='feedback' THEN length(coalesce(payload->'personal'->>'feedback',''))>0 OR EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'personal'->'structured_feedback')='object' THEN payload->'personal'->'structured_feedback' ELSE '{}'::jsonb END) AS f(k,v) WHERE k IN ('value','difficulty','takeaway','question','action','tags') AND v NOT IN ('""'::jsonb,'[]'::jsonb,'null'::jsonb)) ELSE (payload->'personal'->>$6)::boolean END)
      ORDER BY id COLLATE "C" LIMIT $7`,
        [
          o.appId,
          o.userId,
          q.after,
          q.filter === "archived",
          "%" + search + "%",
          q.filter,
          q.limit,
        ],
      )
    ).rows.map((r) => r.payload as T);
  }
  async editions(
    o: LightTickOwner,
    rootId: string,
    after: string,
    limit: number,
  ) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_independent_reading_articles WHERE app_id=$1 AND user_id=$2 AND id COLLATE \"C\">$3 AND (id=$4 OR payload->'provenance'->>'root_article_id'=$4) ORDER BY id COLLATE \"C\" LIMIT $5",
        [o.appId, o.userId, after, rootId, limit],
      )
    ).rows.map((r) => r.payload as ReadingArticle);
  }
  async history(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_independent_reading_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision::bigint<$4::bigint ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as ReadingArticle);
  }
  async save(o: LightTickOwner, row: ReadingArticle, base: number) {
    const args = [o.appId, o.userId, row.id, row.revision, JSON.stringify(row)];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_independent_reading_articles(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_independent_reading_articles SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",
            [...args, base],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Article changed; retain the input.",
      );
    await updateReadingImportIndex(
      this.query,
      o,
      row.id,
      row.content_version,
      row.content.source_url,
    );
    await this.query(
      "INSERT INTO zook_lighttick_independent_reading_versions(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      args,
    );
    await appendDomainChange(this.query, o, {
      domain: "reading",
      resource: "article",
      id: row.id,
      revision: row.revision,
      operation: "upsert",
    });
  }
}
