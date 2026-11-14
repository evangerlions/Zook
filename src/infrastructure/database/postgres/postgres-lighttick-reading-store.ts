import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type {
  LightTickReadingArticleRow,
  LightTickReadingDailyRow,
  LightTickReadingFeedbackRow,
  LightTickReadingGuideRow,
  LightTickReadingStateRow,
} from "../../../modules/lighttick/reading/reading.types.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

const conflict = (message: string) => new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", message);

/**
 * 阅读域存储。
 *
 * 三处刻意写法：
 * 1. `business_date` 用 `::text` 取出，避免 DATE 被 pg 解成本地零点再被通用 mapper 转成 ISO 时间戳；
 * 2. 插入用 `ON CONFLICT DO NOTHING` + 空结果判冲突，与既有 reflection store 一致；
 * 3. 更新一律带 `revision=expected` 做 CAS，读不到行就 409，绝不静默覆盖。
 */
export class PostgresReadingStore {
  constructor(private readonly query: Query, private readonly mapRow: <T>(row: Record<string, unknown>) => T) {}

  private article(row: Record<string, unknown>) {
    return this.mapRow<LightTickReadingArticleRow>(row);
  }

  async listReadingArticles(owner: LightTickOwner): Promise<LightTickReadingArticleRow[]> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 ORDER BY updated_at DESC",
      [owner.appId, owner.userId],
    );
    return result.rows.map((row) => this.article(row));
  }

  async getReadingArticle(owner: LightTickOwner, id: string): Promise<LightTickReadingArticleRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [owner.appId, owner.userId, id],
    );
    return result.rows[0] ? this.article(result.rows[0]) : undefined;
  }

  async findReadingArticleByUrlHash(owner: LightTickOwner, urlHash: string): Promise<LightTickReadingArticleRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 AND url_hash=$3",
      [owner.appId, owner.userId, urlHash],
    );
    return result.rows[0] ? this.article(result.rows[0]) : undefined;
  }

  async saveReadingArticle(row: LightTickReadingArticleRow, expectedRevision?: number): Promise<LightTickReadingArticleRow> {
    const result = expectedRevision === undefined
      ? await this.query(`INSERT INTO zook_lighttick_reading_articles
        (app_id,user_id,id,url,url_hash,title,source,language,topic,summary,body,body_kind,revision,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14) ON CONFLICT DO NOTHING RETURNING *`,
        [row.appId, row.userId, row.id, row.url, row.urlHash, row.title, row.source, row.language, row.topic,
          row.summary, row.body, row.bodyKind, row.createdAt, row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_reading_articles SET
        url=$1,url_hash=$2,title=$3,source=$4,language=$5,topic=$6,summary=$7,body=$8,body_kind=$9,
        revision=revision+1,updated_at=$10
        WHERE app_id=$11 AND user_id=$12 AND id=$13 AND revision=$14 RETURNING *`,
        [row.url, row.urlHash, row.title, row.source, row.language, row.topic, row.summary, row.body, row.bodyKind,
          row.updatedAt, row.appId, row.userId, row.id, expectedRevision]);
    if (!result.rows[0]) throw conflict("Reading article version changed.");
    return this.article(result.rows[0]);
  }

  async deleteReadingArticle(owner: LightTickOwner, id: string): Promise<void> {
    await this.query(
      "DELETE FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [owner.appId, owner.userId, id],
    );
  }

  async getReadingGuide(owner: LightTickOwner, articleId: string): Promise<LightTickReadingGuideRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_guides WHERE app_id=$1 AND user_id=$2 AND article_id=$3",
      [owner.appId, owner.userId, articleId],
    );
    return result.rows[0] ? this.mapRow<LightTickReadingGuideRow>(result.rows[0]) : undefined;
  }

  async saveReadingGuide(row: LightTickReadingGuideRow, expectedRevision?: number): Promise<LightTickReadingGuideRow> {
    const result = expectedRevision === undefined
      ? await this.query(`INSERT INTO zook_lighttick_reading_guides
        (app_id,user_id,article_id,basis,core_points,evidence_limits,language_notes,application_questions,model,revision,generated_at,updated_at)
        VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9,1,$10,$11)
        ON CONFLICT (app_id,user_id,article_id) DO NOTHING RETURNING *`,
        [row.appId, row.userId, row.articleId, row.basis, JSON.stringify(row.corePoints), JSON.stringify(row.evidenceLimits),
          JSON.stringify(row.languageNotes), JSON.stringify(row.applicationQuestions), row.model, row.generatedAt, row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_reading_guides SET
        basis=$1,core_points=$2::jsonb,evidence_limits=$3::jsonb,language_notes=$4::jsonb,application_questions=$5::jsonb,
        model=$6,revision=revision+1,generated_at=$7,updated_at=$8
        WHERE app_id=$9 AND user_id=$10 AND article_id=$11 AND revision=$12 RETURNING *`,
        [row.basis, JSON.stringify(row.corePoints), JSON.stringify(row.evidenceLimits), JSON.stringify(row.languageNotes),
          JSON.stringify(row.applicationQuestions), row.model, row.generatedAt, row.updatedAt,
          row.appId, row.userId, row.articleId, expectedRevision]);
    if (!result.rows[0]) throw conflict("Reading guide version changed.");
    return this.mapRow<LightTickReadingGuideRow>(result.rows[0]);
  }

  async getReadingState(owner: LightTickOwner, articleId: string): Promise<LightTickReadingStateRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_states WHERE app_id=$1 AND user_id=$2 AND article_id=$3",
      [owner.appId, owner.userId, articleId],
    );
    return result.rows[0] ? this.mapRow<LightTickReadingStateRow>(result.rows[0]) : undefined;
  }

  async saveReadingState(row: LightTickReadingStateRow, expectedRevision?: number): Promise<LightTickReadingStateRow> {
    const result = expectedRevision === undefined
      ? await this.query(`INSERT INTO zook_lighttick_reading_states
        (app_id,user_id,article_id,position_ratio,position_anchor,completed_at,revision,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,1,$7) ON CONFLICT DO NOTHING RETURNING *`,
        [row.appId, row.userId, row.articleId, row.positionRatio, row.positionAnchor, row.completedAt, row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_reading_states SET
        position_ratio=$1,position_anchor=$2,completed_at=$3,revision=revision+1,updated_at=$4
        WHERE app_id=$5 AND user_id=$6 AND article_id=$7 AND revision=$8 RETURNING *`,
        [row.positionRatio, row.positionAnchor, row.completedAt, row.updatedAt,
          row.appId, row.userId, row.articleId, expectedRevision]);
    if (!result.rows[0]) throw conflict("Reading position version changed.");
    return this.mapRow<LightTickReadingStateRow>(result.rows[0]);
  }

  async getReadingFeedback(owner: LightTickOwner, articleId: string): Promise<LightTickReadingFeedbackRow | undefined> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_feedback WHERE app_id=$1 AND user_id=$2 AND article_id=$3",
      [owner.appId, owner.userId, articleId],
    );
    return result.rows[0] ? this.mapRow<LightTickReadingFeedbackRow>(result.rows[0]) : undefined;
  }

  async saveReadingFeedback(row: LightTickReadingFeedbackRow, expectedRevision?: number): Promise<LightTickReadingFeedbackRow> {
    const result = expectedRevision === undefined
      ? await this.query(`INSERT INTO zook_lighttick_reading_feedback
        (app_id,user_id,article_id,value_rating,difficulty,takeaway,question,application,tags,revision,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,1,$10) ON CONFLICT DO NOTHING RETURNING *`,
        [row.appId, row.userId, row.articleId, row.valueRating, row.difficulty, row.takeaway, row.question,
          row.application, JSON.stringify(row.tags), row.updatedAt])
      : await this.query(`UPDATE zook_lighttick_reading_feedback SET
        value_rating=$1,difficulty=$2,takeaway=$3,question=$4,application=$5,tags=$6::jsonb,revision=revision+1,updated_at=$7
        WHERE app_id=$8 AND user_id=$9 AND article_id=$10 AND revision=$11 RETURNING *`,
        [row.valueRating, row.difficulty, row.takeaway, row.question, row.application, JSON.stringify(row.tags),
          row.updatedAt, row.appId, row.userId, row.articleId, expectedRevision]);
    if (!result.rows[0]) throw conflict("Reading feedback version changed.");
    return this.mapRow<LightTickReadingFeedbackRow>(result.rows[0]);
  }

  async listReadingDaily(owner: LightTickOwner, businessDate: string): Promise<LightTickReadingDailyRow[]> {
    const result = await this.query(
      `SELECT app_id,user_id,business_date::text AS business_date,ordinal,article_id,reason,created_at
       FROM zook_lighttick_reading_daily
       WHERE app_id=$1 AND user_id=$2 AND business_date=$3::date ORDER BY ordinal`,
      [owner.appId, owner.userId, businessDate],
    );
    return result.rows.map((row) => this.mapRow<LightTickReadingDailyRow>(row));
  }

  /** 近 N 天推荐过的文章，用于「已推荐的不再推荐」。 */
  async listReadingDailySince(owner: LightTickOwner, sinceDate: string): Promise<LightTickReadingDailyRow[]> {
    const result = await this.query(
      `SELECT app_id,user_id,business_date::text AS business_date,ordinal,article_id,reason,created_at
       FROM zook_lighttick_reading_daily
       WHERE app_id=$1 AND user_id=$2 AND business_date>=$3::date ORDER BY business_date DESC, ordinal`,
      [owner.appId, owner.userId, sinceDate],
    );
    return result.rows.map((row) => this.mapRow<LightTickReadingDailyRow>(row));
  }

  async listReadingStates(owner: LightTickOwner): Promise<LightTickReadingStateRow[]> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_states WHERE app_id=$1 AND user_id=$2",
      [owner.appId, owner.userId],
    );
    return result.rows.map((row) => this.mapRow<LightTickReadingStateRow>(row));
  }

  async listReadingFeedback(owner: LightTickOwner): Promise<LightTickReadingFeedbackRow[]> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_feedback WHERE app_id=$1 AND user_id=$2",
      [owner.appId, owner.userId],
    );
    return result.rows.map((row) => this.mapRow<LightTickReadingFeedbackRow>(row));
  }

  async listReadingGuides(owner: LightTickOwner): Promise<LightTickReadingGuideRow[]> {
    const result = await this.query(
      "SELECT * FROM zook_lighttick_reading_guides WHERE app_id=$1 AND user_id=$2",
      [owner.appId, owner.userId],
    );
    return result.rows.map((row) => this.mapRow<LightTickReadingGuideRow>(row));
  }

  async saveReadingDaily(rows: LightTickReadingDailyRow[]): Promise<LightTickReadingDailyRow[]> {
    const saved: LightTickReadingDailyRow[] = [];
    for (const row of rows) {
      const result = await this.query(
        `INSERT INTO zook_lighttick_reading_daily
         (app_id,user_id,business_date,ordinal,article_id,reason,created_at)
         VALUES ($1,$2,$3::date,$4,$5,$6,$7)
         ON CONFLICT (app_id,user_id,business_date,ordinal) DO NOTHING
         RETURNING app_id,user_id,business_date::text AS business_date,ordinal,article_id,reason,created_at`,
        [row.appId, row.userId, row.businessDate, row.ordinal, row.articleId, row.reason, row.createdAt],
      );
      if (result.rows[0]) saved.push(this.mapRow<LightTickReadingDailyRow>(result.rows[0]));
    }
    return saved;
  }
}
