import type { DomainNotifier } from "../modules/lighttick/domain-changes/domain-changes.types.ts";
import type {
  ReadingPreferences,
  ReadingPreferencesRepository,
} from "../modules/lighttick/reading/reading-preferences.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const key = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]);
export class InMemoryReadingPreferencesStore
  implements ReadingPreferencesRepository
{
  constructor(readonly notify: DomainNotifier = async () => {}) {}
  private rows = new Map<string, ReadingPreferences>();
  private versions = new Map<string, ReadingPreferences[]>();
  snapshot() {
    return structuredClone({
      rows: [...this.rows],
      versions: [...this.versions],
    });
  }
  restore(s: ReturnType<InMemoryReadingPreferencesStore["snapshot"]>) {
    this.rows = new Map(s.rows);
    this.versions = new Map(s.versions);
  }
  deleteOwner(o: LightTickOwner) {
    this.rows.delete(key(o));
    this.versions.delete(key(o));
  }
  async get(o: LightTickOwner) {
    return structuredClone(this.rows.get(key(o)));
  }
  async history(o: LightTickOwner, before: number, limit: number) {
    return structuredClone(
      (this.versions.get(key(o)) ?? [])
        .filter((r) => r.revision < before)
        .sort((a, b) => b.revision - a.revision)
        .slice(0, limit),
    );
  }
  async save(o: LightTickOwner, row: ReadingPreferences, base: number) {
    if ((this.rows.get(key(o))?.revision ?? 0) !== base)
      fail(409, "阅读偏好已变化，请保留本机输入核对。");
    this.rows.set(key(o), structuredClone(row));
    this.versions.set(key(o), [
      ...(this.versions.get(key(o)) ?? []),
      structuredClone(row),
    ]);
    await this.notify(o, {
      domain: "reading",
      resource: "preferences",
      id: "reading-preferences",
      revision: row.revision,
      operation: "upsert",
    });
  }
}
