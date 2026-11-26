import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  LearningAuthority,
  UserSubscription,
  UserStorageConfig,
  StorageUsage,
  LearningCollection,
  LearningModule,
  LearningModuleTemplate,
  NativeLesson,
  LessonPublication,
  LessonDesignRecord,
  NativePrivateState,
  LearningHistoryEntry,
  NativeLearningRepository,
} from "../modules/lighttick/learning/native-learning.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const compare = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));
/** design 是嵌套对象：键序不稳定，比较前先做稳定序列化。 */
const stable = (value: unknown): string =>
  Array.isArray(value) ? "[" + value.map(stable).join(",") + "]" :
  value && typeof value === "object"
    ? "{" + Object.keys(value as Record<string, unknown>).sort().map(k => JSON.stringify(k) + ":" + stable((value as Record<string, unknown>)[k])).join(",") + "}"
    : JSON.stringify(value);
const copy = <T>(x: T): T => structuredClone(x),
  key = (o: LightTickOwner, ...ids: string[]) =>
    JSON.stringify([o.appId, o.userId, ...ids]);
export class InMemoryNativeLearningStore implements Omit<
  NativeLearningRepository,
  "listLearningReceipts"
> {
  private subscriptions = new Map<string, UserSubscription>();
  private storage = new Map<string, UserStorageConfig>();
  private authorities = new Map<string, LearningAuthority>();
  private collections = new Map<string, LearningCollection>();
  private lessons = new Map<string, NativeLesson>();
  private publications = new Map<string, LessonPublication>();
  private designs = new Map<string, LessonDesignRecord>();
  private states = new Map<string, NativePrivateState>();
  private history = new Map<string, LearningHistoryEntry>();
  private modules = new Map<string, LearningModule>();
  async exportAuthorized(o:LightTickOwner,includePrivate:boolean){
    const visible=(r:{appId:string;userId:string;lessonId:string})=>{const l=this.lessons.get(key(o,r.lessonId));return r.appId===o.appId&&r.userId===o.userId&&!!l&&!l.archived&&!this.collections.get(key(o,l.collectionId))?.archived;};
    const result={publications:[...this.publications.values()].filter(visible),states:includePrivate?[...this.states.values()].filter(visible):[],history:includePrivate?[...this.history.values()].filter(visible):[]};
    if(Object.values(result).some(rows=>rows.length>5000))throw new ApplicationError(413,'VALIDATION_ERROR','Learning export exceeds capacity.');return copy(result);
  }
  async getNativeLearningCounts(o: LightTickOwner) {
    return Object.fromEntries(
      Object.entries({
        collections: this.collections,
        lessons: this.lessons,
        publications: this.publications,
        states: this.states,
        history: this.history,
      }).map(([name, map]) => [
        name,
        [...map.values()].filter(
          (r) => r.appId === o.appId && r.userId === o.userId,
        ).length,
      ]),
    );
  }
  async clearNativeLearningStaging(o: LightTickOwner) {
    for (const map of [
      this.collections,
      this.lessons,
      this.publications,
      this.designs,
      this.states,
      this.history,
      this.modules,
    ])
      for (const [id, r] of map)
        if (r.appId === o.appId && r.userId === o.userId) map.delete(id);
  }
  snapshot() {
    return copy({
      modules: [...this.modules],
      authorities: [...this.authorities],
      collections: [...this.collections],
      lessons: [...this.lessons],
      publications: [...this.publications],
      designs: [...this.designs],
      states: [...this.states],
      history: [...this.history],
      subscriptions: [...this.subscriptions],
      storage: [...this.storage],
    });
  }
  restore(v: ReturnType<InMemoryNativeLearningStore["snapshot"]>) {
    this.modules = new Map(v.modules);
    this.authorities = new Map(v.authorities);
    this.collections = new Map(v.collections);
    this.lessons = new Map(v.lessons);
    this.publications = new Map(v.publications);
    this.designs = new Map(v.designs);
    this.states = new Map(v.states);
    this.history = new Map(v.history);
    this.subscriptions = new Map(v.subscriptions);
    this.storage = new Map(v.storage);
  }
  deleteOwner(o: LightTickOwner) {
    this.subscriptions.delete(key(o));
    for(const [id,r] of this.storage) if(r.userId===o.userId && o.appId==="lighttick")this.storage.delete(id);
    for (const map of [
      this.authorities,
      this.collections,
      this.lessons,
      this.publications,
      this.states,
      this.history,
    ])
      for (const [k, v] of map)
        if (v.appId === o.appId && v.userId === o.userId) map.delete(k);
  }
  private put<
    T extends {
      revision: number;
    },
  >(map: Map<string, T>, id: string, row: T, base: number) {
    if ((map.get(id)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Learning revision changed.",
      );
    map.set(id, copy(row));
  }
  async listLearningModules(owner: LightTickOwner) {
    return copy([...this.modules.values()]
      .filter(row => row.appId === owner.appId && row.userId === owner.userId)
      .sort((left, right) => compare(left.id, right.id)));
  }
  async getLearningModule(owner: LightTickOwner, id: string) {
    return copy(this.modules.get(key(owner, id)));
  }
  async saveLearningModule(row: LearningModule, base: number) {
    this.put(this.modules, key(row, row.id), row, base);
  }
  async listLearningModuleTemplates(): Promise<LearningModuleTemplate[]> {
    return [];
  }
  async getLearningAuthority(o: LightTickOwner) {
    return copy(this.authorities.get(key(o)));
  }
  async saveLearningAuthority(r: LearningAuthority, base: number) {
    this.put(this.authorities, key(r), r, base);
  }
  async listLearningCollections(
    o: LightTickOwner,
    after: string,
    limit: number,
    moduleId?: string,
  ) {
    return copy(
      [...this.collections.values()]
        .filter(
          (r) =>
            r.appId === o.appId &&
            r.userId === o.userId &&
            compare(r.id, after) > 0 &&
            (moduleId === undefined || r.moduleId === moduleId),
        )
        .sort((a, b) => compare(a.id, b.id))
        .slice(0, limit),
    );
  }
  async getLearningCollection(o: LightTickOwner, id: string) {
    return copy(this.collections.get(key(o, id)));
  }
  async saveLearningCollection(r: LearningCollection, base: number) {
    this.put(this.collections, key(r, r.id), r, base);
  }
  async listNativeLessons(
    o: LightTickOwner,
    after: string,
    limit: number,
    collectionId?: string,
    moduleId?: string,
  ) {
    return copy(
      [...this.lessons.values()]
        .filter(
          (r) =>
            r.appId === o.appId &&
            r.userId === o.userId &&
            compare(r.id, after) > 0 &&
            (!collectionId || r.collectionId === collectionId) &&
            (moduleId === undefined || r.moduleId === moduleId),
        )
        .sort((a, b) => compare(a.id, b.id))
        .slice(0, limit),
    );
  }
  async getNativeLesson(o: LightTickOwner, id: string) {
    return copy(this.lessons.get(key(o, id)));
  }
  async saveNativeLesson(r: NativeLesson, base: number) {
    if (!this.collections.has(key(r, r.collectionId)))
      throw Error("Collection missing");
    if (
      [...this.lessons.values()].some(
        (old) =>
          old.appId === r.appId &&
          old.userId === r.userId &&
          old.collectionId === r.collectionId &&
          old.number === r.number &&
          old.id !== r.id,
      )
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Lesson ordinal belongs to another identity.",
      );
    this.put(this.lessons, key(r, r.id), r, base);
  }
  async getLessonPublication(o: LightTickOwner, id: string, v: string) {
    return copy(this.publications.get(key(o, id, v)));
  }
  async insertLessonPublication(r: LessonPublication) {
    const id = key(r, r.lessonId, r.contentVersion),
      old = this.publications.get(id);
    if (
      old &&
      (old.content !== r.content ||
        old.references !== r.references ||
        old.sourceUrl !== r.sourceUrl ||
        (old.tutorTopic ?? null) !== (r.tutorTopic ?? null))
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Published content is immutable.",
      );
    if (!old) this.publications.set(id, copy(r));
  }
  async getLessonDesign(o: LightTickOwner, id: string, v: string) {
    return copy(this.designs.get(key(o, id, v)));
  }
  async insertLessonDesign(r: LessonDesignRecord) {
    const id = key(r, r.lessonId, r.contentVersion),
      old = this.designs.get(id);
    if (old && stable(old.design) !== stable(r.design))
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Published lesson design is immutable.",
      );
    if (!old) this.designs.set(id, copy(r));
  }
  async getNativePrivateState(o: LightTickOwner, id: string, v: string) {
    return copy(this.states.get(key(o, id, v)));
  }
  async saveNativePrivateState(r: NativePrivateState, base: number) {
    this.put(this.states, key(r, r.lessonId, r.contentVersion), r, base);
  }
  async listCompletedLessons(o: LightTickOwner, startsOn: string, endsOn: string, limit: number) {
    return [...this.states.values()]
      .filter((s) => s.appId === o.appId && s.userId === o.userId && s.completed && s.completedAt)
      .filter((s) => {
        const day = String(s.completedAt).slice(0, 10);
        return day >= startsOn && day <= endsOn;
      })
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)) || a.lessonId.localeCompare(b.lessonId))
      .slice(0, limit)
      .map((s) => ({ lessonId: s.lessonId, contentVersion: s.contentVersion, completedAt: String(s.completedAt) }));
  }
  async appendLearningHistory(r: LearningHistoryEntry) {
    if (
      [...this.history.values()].some(
        (old) =>
          old.appId === r.appId &&
          old.userId === r.userId &&
          old.lessonId === r.lessonId &&
          old.contentVersion === r.contentVersion &&
          old.revision === r.revision,
      )
    )
      throw Error("Duplicate learning history");
    this.history.set(key(r, r.id), copy(r));
  }
  async listLearningHistory(
    o: LightTickOwner,
    id: string,
    v: string,
    before: string,
    limit: number,
  ) {
    return copy(
      [...this.history.values()]
        .filter(
          (r) =>
            r.appId === o.appId &&
            r.userId === o.userId &&
            r.lessonId === id &&
            r.contentVersion === v &&
            (!before || r.revision < Number(before)),
        )
        .sort((a, b) => b.revision - a.revision)
        .slice(0, limit),
    );
  }
  async getUserSubscription(o: LightTickOwner) { return copy(this.subscriptions.get(key(o))); }
  async saveUserSubscription(row: UserSubscription) { this.subscriptions.set(key({appId:'lighttick',userId:row.userId}),copy(row)); }
  async getUserStorage(o: LightTickOwner,id: string) { return copy(this.storage.get(key(o,id))); }
  async listUserStorage(o: LightTickOwner) { return copy([...this.storage.values()].filter(r=>r.userId===o.userId&&o.appId==='lighttick')); }
  async saveUserStorage(row: UserStorageConfig) {
    const o={appId:'lighttick' as const,userId:row.userId};
    const prior=[...this.storage.values()].find(r=>r.userId===row.userId&&r.type===row.type);
    const id=prior?.id??row.id??'storage-'+row.type;
    this.storage.set(key(o,id),copy({...row,id}));
  }
  async deleteUserStorage(o: LightTickOwner,id: string) { this.storage.delete(key(o,id)); }
  async getStorageUsage(o: LightTickOwner): Promise<StorageUsage> {
    const modules=await this.listLearningModules(o),lessons=await this.listNativeLessons(o,'',Number.MAX_SAFE_INTEGER);
    const totalUsed=modules.reduce((n,r)=>n+(r.storageUsed??0),0),totalLimit=500*1024*1024;
    return {userId:o.userId,totalUsed,totalLimit,percentage:Math.round(totalUsed/totalLimit*100),
      breakdown:{modules:{count:modules.length,size:totalUsed},lessons:{count:lessons.length,size:0},attachments:{count:0,size:0},versions:{count:0,size:0}},
      topModules:modules.map(m=>({moduleId:m.id,title:m.title,size:m.storageUsed??0})).sort((a,b)=>b.size-a.size).slice(0,5),updatedAt:new Date().toISOString()};
  }

}
