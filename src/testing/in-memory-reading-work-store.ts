import {InMemoryReadingAssetsStore} from "./in-memory-reading-assets-store.ts";
import { InMemoryReadingPreferencesStore } from "./in-memory-reading-preferences-store.ts";
import type {
  ReadingWorkRepository,
  ReadingWork,
  ReadingSource,
} from "../modules/lighttick/reading/reading-work.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]) + ":";
const key = (o: LightTickOwner, id: string) => prefix(o) + id;
const copy = <T>(v: T): T => structuredClone(v);
export class InMemoryReadingWorkStore implements ReadingWorkRepository {
  readonly assets = new InMemoryReadingAssetsStore();
  readonly preferences = new InMemoryReadingPreferencesStore();
  private work = new Map<string, ReadingWork>();
  private rows = new Map<string, ReadingSource>();
  private versions = new Map<string, ReadingSource[]>();
  snapshot() {
    return copy({
      assets:this.assets.snapshot(),
      preferences: this.preferences.snapshot(),
      work: [...this.work],
      rows: [...this.rows],
      versions: [...this.versions],
    });
  }
  restore(s: ReturnType<InMemoryReadingWorkStore["snapshot"]>) {
    this.assets.restore(s.assets);
    this.preferences.restore(s.preferences);
    this.work = new Map(s.work);
    this.rows = new Map(s.rows);
    this.versions = new Map(s.versions);
  }
  deleteOwner(o: LightTickOwner) {
    this.assets.deleteOwner(o);
    this.preferences.deleteOwner(o);
    for (const map of [this.work, this.rows, this.versions])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
  async source(o: LightTickOwner, id: string) {
    return copy(this.rows.get(key(o, id)));
  }
  async sources(
    o: LightTickOwner,
    after: string,
    limit: number,
    includeDeleted = false,
  ) {
    return copy(
      [...this.rows]
        .filter(
          ([k, r]) =>
            k.startsWith(prefix(o)) &&
            r.id > after &&
            (includeDeleted || !r.deleted_at),
        )
        .map(([, r]) => r)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit),
    );
  }
  async sourceHistory(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ) {
    return copy(
      (this.versions.get(key(o, id)) ?? [])
        .filter((r) => r.revision < before)
        .sort((a, b) => b.revision - a.revision)
        .slice(0, limit),
    );
  }
  async saveSource(o: LightTickOwner, row: ReadingSource, base: number) {
    const k = key(o, row.id);
    if ((this.rows.get(k)?.revision ?? 0) !== base)
      fail(409, "阅读源已变化，请保留输入核对。");
    this.rows.set(k, copy(row));
    this.versions.set(k, [...(this.versions.get(k) ?? []), copy(row)]);
  }
  async get(o: LightTickOwner, id: string) {
    return copy(this.work.get(key(o, id)));
  }
  async list(o: LightTickOwner, after: string, limit: number) {
    return copy(
      [...this.work.values()]
        .filter(
          (r) => r.appId === o.appId && r.userId === o.userId && r.id > after,
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit),
    );
  }
  async recent(o: LightTickOwner, since: string) {
    return copy(
      [...this.work.values()].filter(
        (r) =>
          r.appId === o.appId && r.userId === o.userId && r.created_at >= since,
      ),
    );
  }
  async recoverable(now: string, limit: number) {
    return copy(
      [...this.work.values()]
        .filter(
          (r) =>
            r.status === "queued" ||
            (r.status === "running" && r.lease_until! <= now),
        )
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .slice(0, limit),
    );
  }
  async save(row: ReadingWork, base: number) {
    const k = key(row, row.id);
    if ((this.work.get(k)?.revision ?? 0) !== base)
      fail(409, "阅读任务已变化，请核对原请求。");
    this.work.set(k, copy(row));
  }
}
