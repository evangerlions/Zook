import type {
  LightTickOwner,
  LightTickOperationRow,
} from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingBackupSection,
  ReadingBackupRecord,
} from "../modules/lighttick/reading/reading-backup.types.ts";
import { portableReadingRecord } from "../modules/lighttick/reading/reading-backup-record.ts";
import type { InMemoryReadingStore } from "./in-memory-reading-store.ts";
import type { InMemoryReadingWorkStore } from "./in-memory-reading-work-store.ts";
export async function memoryReadingBackupEntries(
  reading: InMemoryReadingStore,
  work: InMemoryReadingWorkStore,
  operations: LightTickOperationRow[],
  o: LightTickOwner,
  section: ReadingBackupSection,
  after: string,
  limit: number,
) {
  const prefix = JSON.stringify([o.appId, o.userId]) + ":",
    ownerKey = JSON.stringify([o.appId, o.userId]),
    rows: ReadingBackupRecord[] = [];
  const add = (key: string, value: unknown) =>
    rows.push(portableReadingRecord(section, key, value));
  if (
    section === "articles" ||
    section === "article_versions" ||
    section === "vocabulary" ||
    section === "vocabulary_reviews"
  ) {
    const snapshot = reading.snapshot();
    if(section==="articles") for(const [k,t] of snapshot.tombstones) if(k.startsWith(JSON.stringify([o.appId,o.userId]).slice(0,-1)+",")) add(t.id,t);
    if (section === "articles" || section === "article_versions")
      for (const [, r] of snapshot.articles) {
        if (r.owner.appId !== o.appId || r.owner.userId !== o.userId) continue;
        if (section === "articles") {
          const row = r.versions.at(-1)!;
          add(row.id, row);
        } else
          for (const row of r.versions)
            add(JSON.stringify([row.id, row.revision]), row);
      }
    else
      for (const [k, r] of snapshot.vocabulary) {
        if (r.owner.appId !== o.appId || r.owner.userId !== o.userId) continue;
        const id = JSON.parse(k)[2];
        if (section === "vocabulary") add(id, r.entry);
        else
          for (const [i, row] of r.reviews.entries())
            add(JSON.stringify([id, r.reviewRevisions[i]]), row);
      }
  } else if (section === "receipts")
    for (const row of operations) {
      if (
        row.appId === o.appId &&
        row.userId === o.userId &&
        ["reading_article", "reading_work", "reading_vocabulary", "reading_erasure"].includes(
          row.entityType,
        )
      )
        add(row.operationId, row);
    }
  else {
    const snapshot = work.snapshot();
    if (section === "sources")
      for (const [k, row] of snapshot.rows) {
        if (k.startsWith(prefix)) add(row.id, row);
      }
    if (section === "source_versions")
      for (const [k, versions] of snapshot.versions) {
        if (k.startsWith(prefix))
          for (const row of versions)
            add(JSON.stringify([row.id, row.revision]), row);
      }
    if (section === "work")
      for (const [k, row] of snapshot.work) {
        if (k.startsWith(prefix)) add(row.id, row);
      }
    if (section === "work_assets")
      for (const [k, row] of snapshot.assets) {
        if (k.startsWith(prefix))
          add(JSON.stringify([row.work_id, row.id]), row);
      }
    if (section === "preferences")
      for (const [k, row] of snapshot.preferences.rows) {
        if (k === ownerKey) add("preferences", row);
      }
    if (section === "preference_versions")
      for (const [k, versions] of snapshot.preferences.versions) {
        if (k === ownerKey)
          for (const row of versions) add(String(row.revision), row);
      }
    if (section === "schedule")
      for (const [k, row] of snapshot.schedule) {
        if (k.startsWith(prefix)) add(row.date, row);
      }
  }
  return rows
    .filter((r) => r.key > after)
    .sort((a, b) => (a.key < b.key ? -1 : 1))
    .slice(0, limit);
}
