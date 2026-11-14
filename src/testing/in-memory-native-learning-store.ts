import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  LearningAuthority,
  LearningCollection,
  NativeLesson,
  LessonPublication,
  NativePrivateState,
  LearningHistoryEntry,
  NativeLearningRepository, LearningModule, StorageConfig, UserSubscription,
} from "../modules/lighttick/learning/native-learning.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const compare = (a: string, b: string) =>
  Buffer.compare(Buffer.from(a), Buffer.from(b));
const copy = <T>(x: T): T => structuredClone(x),
  key = (o: LightTickOwner, ...ids: string[]) =>
    JSON.stringify([o.appId, o.userId, ...ids]);
export class InMemoryNativeLearningStore implements Omit<
  NativeLearningRepository,
  "listLearningReceipts"
> {
  private modules = new Map<string, LearningModule>();
  private storage = new Map<string, StorageConfig>();
  private subscriptions = new Map<string, UserSubscription>();
  private authorities = new Map<string, LearningAuthority>();
  private collections = new Map<string, LearningCollection>();
  private lessons = new Map<string, NativeLesson>();
  private publications = new Map<string, LessonPublication>();
  private states = new Map<string, NativePrivateState>();
  private history = new Map<string, LearningHistoryEntry>();
  async listLearningModules(o: LightTickOwner) { return copy([...this.modules.values()].filter(r => r.appId === o.appId && r.userId === o.userId)); }
  async getLearningModule(o: LightTickOwner, id: string) { return copy(this.modules.get(key(o,id))); }
  async saveLearningModule(r: LearningModule, base: number) { this.put(this.modules,key(r,r.id),r,base); }
  async listLearningModuleTemplates() { return []; }
  async getUserSubscription(o: LightTickOwner) { return copy(this.subscriptions.get(key(o))); }
  async saveUserSubscription(r: UserSubscription) { this.subscriptions.set(key({appId:"lighttick",userId:r.userId}),copy(r)); }
  async listUserStorage(o: LightTickOwner) { return copy([...this.storage.entries()].filter(([k]) => k.startsWith(JSON.stringify([o.appId,o.userId]).slice(0,-1)+",")).map(([,r]) => r)); }
  async getUserStorage(o: LightTickOwner, id: string) { return copy(this.storage.get(key(o,id))); }
  async saveUserStorage(r: StorageConfig) { this.storage.set(key({appId:"lighttick",userId:r.userId!},r.id!),copy(r)); }
  async deleteUserStorage(o: LightTickOwner, id: string) { this.storage.delete(key(o,id)); }
  async getStorageUsage(o: LightTickOwner) {
    const publications = [...this.publications.values()].filter(r => r.appId === o.appId && r.userId === o.userId);
    const size = publications.reduce((n,r) => n + Buffer.byteLength(r.content) + Buffer.byteLength(r.references),0);
    return { userId:o.userId,totalUsed:size,totalLimit:524288000,percentage:Math.round(size/524288000*100),
      breakdown:{modules:{count:(await this.listLearningModules(o)).length,size:0},lessons:{count:(await this.listNativeLessons(o,"",10000)).length,size:0},attachments:{count:0,size:0},versions:{count:publications.length,size}},topModules:[],updatedAt:new Date().toISOString() };
  }
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
      this.states,
      this.history,
    ])
      for (const [id, r] of map)
        if (r.appId === o.appId && r.userId === o.userId) map.delete(id);
  }
  snapshot() {
    return copy({
      modules: [...this.modules], storage: [...this.storage], subscriptions: [...this.subscriptions],
      authorities: [...this.authorities],
      collections: [...this.collections],
      lessons: [...this.lessons],
      publications: [...this.publications],
      states: [...this.states],
      history: [...this.history],
    });
  }
  restore(v: ReturnType<InMemoryNativeLearningStore["snapshot"]>) {
    this.modules = new Map(v.modules); this.storage = new Map(v.storage); this.subscriptions = new Map(v.subscriptions);
    this.authorities = new Map(v.authorities);
    this.collections = new Map(v.collections);
    this.lessons = new Map(v.lessons);
    this.publications = new Map(v.publications);
    this.states = new Map(v.states);
    this.history = new Map(v.history);
  }
  deleteOwner(o: LightTickOwner) {
    const prefix = JSON.stringify([o.appId,o.userId]).slice(0,-1) + ",";
    for (const k of this.storage.keys()) if (k.startsWith(prefix)) this.storage.delete(k);
    this.subscriptions.delete(key(o));
    for (const map of [
      this.modules,
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
            compare(r.id, after) > 0 && (!moduleId || r.moduleId === moduleId),
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
            (!collectionId || r.collectionId === collectionId) && (!moduleId || r.moduleId === moduleId),
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
        old.sourceUrl !== r.sourceUrl)
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Published content is immutable.",
      );
    if (!old) this.publications.set(id, copy(r));
  }
  async getNativePrivateState(o: LightTickOwner, id: string, v: string) {
    return copy(this.states.get(key(o, id, v)));
  }
  async saveNativePrivateState(r: NativePrivateState, base: number) {
    this.put(this.states, key(r, r.lessonId, r.contentVersion), r, base);
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
}
