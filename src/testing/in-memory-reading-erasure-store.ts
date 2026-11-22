import { relatedReadingWork } from "../modules/lighttick/independent-reading/reading-erasure.types.ts";
import type {
  ReadingErasureRepository,
  ReadingErasureTargets,
  ReadingTombstone,
} from "../modules/lighttick/independent-reading/reading-erasure.types.ts";
import type { ReadingArticle } from "../modules/lighttick/independent-reading/reading.types.ts";
import type {
  LightTickOwner,
  LightTickOperationRow,
} from "../modules/lighttick/lighttick.types.ts";
import type { InMemoryIndependentReadingStore } from "./in-memory-independent-reading-store.ts";
import type { InMemoryReadingWorkStore } from "./in-memory-reading-work-store.ts";
import { digest } from "../modules/lighttick/learning/native-learning.validation.ts";
export class InMemoryReadingErasureStore implements ReadingErasureRepository {
  constructor(
    readonly reading: () => InMemoryIndependentReadingStore,
    readonly work: () => InMemoryReadingWorkStore,
    readonly operations: () => LightTickOperationRow[],
  ) {}
  async versionCount(o: LightTickOwner, id: string) {
    return (await this.reading().history(o, id, 2147483648, 10001)).length;
  }
  async contentTombstone(o: LightTickOwner, version: string) {
    return this.reading()
      .snapshot()
      .tombstones.filter(
        ([k, t]) =>
          k.startsWith(
            JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",",
          ) && t.content_version === version,
      )
      .map(([, t]) => t)
      .sort((a, b) => (a.deleted_at > b.deleted_at ? -1 : 1))[0];
  }
  tombstone(o: LightTickOwner, id: string) {
    return this.reading().tombstone(o, id);
  }
  async related(o: LightTickOwner, a: ReadingArticle) {
    return (await this.work().list(o, "", Number.MAX_SAFE_INTEGER))
      .filter((w) => relatedReadingWork(w, a))
      .slice(0, 101)
      .map((w) => ({ ...w, input: {}, output: null }));
  }
  private affected(o: LightTickOwner, t: ReadingErasureTargets) {
    const words = new Set(t.vocabulary_ids);
    for (const r of this.operations())
      if (
        r.appId === o.appId &&
        r.userId === o.userId &&
        r.entityType === "reading_vocabulary" &&
        (r.requestPayload.article_id === t.article_id ||
          (r.resultPayload.entry as { article_id?: string })?.article_id ===
            t.article_id)
      )
        words.add(r.entityId);
    return this.operations().filter(
      (r) =>
        r.appId === o.appId &&
        r.userId === o.userId &&
        ((r.entityType === "reading_article" && r.entityId === t.article_id) ||
          (r.entityType === "reading_work" &&
            t.work_ids.includes(r.entityId)) ||
          (r.entityType === "reading_vocabulary" && words.has(r.entityId))),
    );
  }
  async receipts(o: LightTickOwner, t: ReadingErasureTargets) {
    return this.affected(o, t)
      .map((r) => ({
        operation_id: r.operationId,
        payload_hash: r.payloadHash,
      }))
      .sort((a, b) => (a.operation_id < b.operation_id ? -1 : 1))
      .slice(0, 10001);
  }
  async erase(
    o: LightTickOwner,
    t: ReadingTombstone,
    targets: ReadingErasureTargets,
  ) {
    await this.reading().eraseArticle(o, t);
    for (const id of targets.vocabulary_ids)
      await this.reading().deleteVocabulary(o, id);
    for (const id of targets.work_ids)
      await this.work().assets.eraseWork(o, id);
    for (const row of this.affected(o, targets))
      if (row.resultPayload.erased !== true) {
        const result_digest = digest(row.resultPayload);
        row.requestPayload = {};
        row.resultPayload = {
          erased: true,
          entity_id: row.entityId,
          deleted_article_id: t.id,
          result_digest,
          digest_version: "canonical-json-sha256-v1",
        };
        row.updatedAt = t.deleted_at;
      }
  }
}
