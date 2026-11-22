import { PostgresReadingStore } from "./postgres-lighttick-reading-store.ts";
import type {
  LightTickReadingArticleRow, LightTickReadingDailyRow, LightTickReadingFeedbackRow,
  LightTickReadingGuideRow, LightTickReadingStateRow,
} from "../../../modules/lighttick/reading/reading.types.ts";
import type { ReadingEntries } from "../../../modules/lighttick/reading/reading-workflow.types.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";

export abstract class PostgresLightTickLearningRepository {
  protected abstract query(sql: string, values?: unknown[]): Promise<QueryResult>;
  async getReadingEntry<K extends keyof ReadingEntries>(owner: LightTickOwner, kind: K, id: string): Promise<ReadingEntries[K] | undefined> {
    const result = await this.query("SELECT data FROM zook_lighttick_reading_workflow WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4", [owner.appId,owner.userId,kind,id]);
    return result.rows[0]?.data as ReadingEntries[K] | undefined;
  }
  async listReadingEntries<K extends keyof ReadingEntries>(owner: LightTickOwner, kind: K, options: {businessDate?:string;limit?:number;start?:string;end?:string} = {}): Promise<ReadingEntries[K][]> {
    const result = await this.query("SELECT data FROM zook_lighttick_reading_workflow WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND ($4::text IS NULL OR data->>'business_date'=$4) AND ($6::text IS NULL OR data->>'business_date'>=$6) AND ($7::text IS NULL OR data->>'business_date'<=$7) ORDER BY updated_at DESC,id ASC LIMIT $5", [owner.appId,owner.userId,kind,options.businessDate??null,options.limit??5000,options.start??null,options.end??null]);
    return result.rows.map(row=>row.data as ReadingEntries[K]);
  }
  async saveReadingEntry<K extends keyof ReadingEntries>(owner: LightTickOwner, kind: K, entry: ReadingEntries[K]): Promise<void> {
    await this.query(`INSERT INTO zook_lighttick_reading_workflow(app_id,user_id,kind,id,data,updated_at) VALUES($1,$2,$3,$4,$5::jsonb,$6)
      ON CONFLICT(app_id,user_id,kind,id) DO UPDATE SET data=EXCLUDED.data,updated_at=EXCLUDED.updated_at`,[owner.appId,owner.userId,kind,entry.id,JSON.stringify(entry),entry.updated_at]);
  }
  async deleteReadingEntry(owner: LightTickOwner, kind: keyof ReadingEntries, id: string): Promise<void> {
    await this.query("DELETE FROM zook_lighttick_reading_workflow WHERE app_id=$1 AND user_id=$2 AND kind=$3 AND id=$4",[owner.appId,owner.userId,kind,id]);
  }
  private reading() { return new PostgresReadingStore(this.query.bind(this), mapRow); }
  listReadingArticles(owner: LightTickOwner) { return this.reading().listReadingArticles(owner); }
  getReadingArticle(owner: LightTickOwner, id: string) { return this.reading().getReadingArticle(owner, id); }
  findReadingArticleByUrlHash(owner: LightTickOwner, urlHash: string) { return this.reading().findReadingArticleByUrlHash(owner, urlHash); }
  saveReadingArticle(row: LightTickReadingArticleRow, expectedRevision?: number) { return this.reading().saveReadingArticle(row, expectedRevision); }
  deleteReadingArticle(owner: LightTickOwner, id: string) { return this.reading().deleteReadingArticle(owner, id); }
  getReadingGuide(owner: LightTickOwner, articleId: string) { return this.reading().getReadingGuide(owner, articleId); }
  saveReadingGuide(row: LightTickReadingGuideRow, expectedRevision?: number) { return this.reading().saveReadingGuide(row, expectedRevision); }
  getReadingState(owner: LightTickOwner, articleId: string) { return this.reading().getReadingState(owner, articleId); }
  saveReadingState(row: LightTickReadingStateRow, expectedRevision?: number) { return this.reading().saveReadingState(row, expectedRevision); }
  getReadingFeedback(owner: LightTickOwner, articleId: string) { return this.reading().getReadingFeedback(owner, articleId); }
  saveReadingFeedback(row: LightTickReadingFeedbackRow, expectedRevision?: number) { return this.reading().saveReadingFeedback(row, expectedRevision); }
  listReadingDaily(owner: LightTickOwner, businessDate: string) { return this.reading().listReadingDaily(owner, businessDate); }
  listReadingDailySince(owner: LightTickOwner, sinceDate: string) { return this.reading().listReadingDailySince(owner, sinceDate); }
  listReadingStates(owner: LightTickOwner) { return this.reading().listReadingStates(owner); }
  listReadingFeedback(owner: LightTickOwner) { return this.reading().listReadingFeedback(owner); }
  listReadingGuides(owner: LightTickOwner) { return this.reading().listReadingGuides(owner); }
  saveReadingDaily(rows: LightTickReadingDailyRow[]) { return this.reading().saveReadingDaily(rows); }
}
