import {PostgresAccountReportStore} from "./postgres-account-report-store.ts";
import type { ReadingEntries } from "../../../modules/lighttick/reading/reading-workflow.types.ts";
import { PostgresLearningNotebookStore } from "./postgres-learning-notebook-store.ts";
import { PostgresNativeLearningStore } from "./postgres-lighttick-native-learning-store.ts";
import { PostgresReadingStore } from "./postgres-lighttick-reading-store.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
import type { PostgresLearningRouteStore } from "./postgres-learning-route-store.ts";
import type { QueryResult } from "./postgres-lighttick-owner-transaction.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { LightTickReadingArticleRow, LightTickReadingDailyRow, LightTickReadingFeedbackRow, LightTickReadingGuideRow, LightTickReadingStateRow } from "../../../modules/lighttick/reading/reading.types.ts";
/** Learning adapters share the concrete repository's owner-scoped transaction and query. */
export abstract class PostgresLightTickLearningRepository {
  readonly accountReports=new PostgresAccountReportStore((sql,args)=>this.query(sql,args));
  protected abstract query(sql: string, values?: unknown[]): Promise<QueryResult>;
  abstract transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T>;
  abstract readonly learningRoutes: PostgresLearningRouteStore;
  queryLearningNotebook=(owner:LightTickOwner,input:import("../../../modules/lighttick/learning/learning-notebook.types.ts").NotebookQuery)=>new PostgresLearningNotebookStore((sql,args)=>this.query(sql,args)).list(owner,input);
  protected readonly nativeLearning=new PostgresNativeLearningStore((sql,values)=>this.query(sql,values));
  getNativeLearningCounts=async(o:LightTickOwner)=>({...await this.nativeLearning.getNativeLearningCounts(o),...await this.learningRoutes.counts(o)});
  clearNativeLearningStaging=(owner:LightTickOwner)=>this.transaction(owner,async()=>{await this.learningRoutes.clearStaging(owner);await this.nativeLearning.clearNativeLearningStaging(owner);});
  listLearningReceipts=this.nativeLearning.listLearningReceipts.bind(this.nativeLearning);
  getLearningAuthority=this.nativeLearning.getLearningAuthority.bind(this.nativeLearning);
  saveLearningAuthority=(...args:Parameters<PostgresNativeLearningStore["saveLearningAuthority"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningAuthority(...args));
  listLearningCollections=this.nativeLearning.listLearningCollections.bind(this.nativeLearning);
  getLearningCollection=this.nativeLearning.getLearningCollection.bind(this.nativeLearning);
  saveLearningCollection=(...args:Parameters<PostgresNativeLearningStore["saveLearningCollection"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningCollection(...args));
  listNativeLessons=this.nativeLearning.listNativeLessons.bind(this.nativeLearning);
  getNativeLesson=this.nativeLearning.getNativeLesson.bind(this.nativeLearning);
  saveNativeLesson=(...args:Parameters<PostgresNativeLearningStore["saveNativeLesson"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveNativeLesson(...args));
  getLessonPublication=this.nativeLearning.getLessonPublication.bind(this.nativeLearning);
  insertLessonPublication=(...args:Parameters<PostgresNativeLearningStore["insertLessonPublication"]>)=>this.transaction(args[0],()=>this.nativeLearning.insertLessonPublication(...args));
  getNativePrivateState=this.nativeLearning.getNativePrivateState.bind(this.nativeLearning);
  saveNativePrivateState=(...args:Parameters<PostgresNativeLearningStore["saveNativePrivateState"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveNativePrivateState(...args));
  appendLearningHistory=(...args:Parameters<PostgresNativeLearningStore["appendLearningHistory"]>)=>this.transaction(args[0],()=>this.nativeLearning.appendLearningHistory(...args));
  listLearningHistory=this.nativeLearning.listLearningHistory.bind(this.nativeLearning);
  listLearningModules=this.nativeLearning.listLearningModules.bind(this.nativeLearning);
  getLearningModule=this.nativeLearning.getLearningModule.bind(this.nativeLearning);
  saveLearningModule=(...args:Parameters<PostgresNativeLearningStore["saveLearningModule"]>)=>this.transaction(args[0],()=>this.nativeLearning.saveLearningModule(...args));
  getUserSubscription=this.nativeLearning.getUserSubscription.bind(this.nativeLearning);
  getStorageUsage=this.nativeLearning.getStorageUsage.bind(this.nativeLearning);
  getUserStorage=this.nativeLearning.getUserStorage.bind(this.nativeLearning);
  listUserStorage=this.nativeLearning.listUserStorage.bind(this.nativeLearning);
  saveUserStorage=(r: import("../../../modules/lighttick/learning/native-learning.types.ts").StorageConfig)=>this.transaction({appId:"lighttick",userId:r.userId!},()=>this.nativeLearning.saveUserStorage(r));
  deleteUserStorage=(o:LightTickOwner,id:string)=>this.transaction(o,()=>this.nativeLearning.deleteUserStorage(o,id));
  saveUserSubscription=this.nativeLearning.saveUserSubscription.bind(this.nativeLearning);
  listLearningModuleTemplates=this.nativeLearning.listLearningModuleTemplates.bind(this.nativeLearning);
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
