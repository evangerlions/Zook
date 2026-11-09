import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  workSummary,
  type Definition,
  type ScreenWork,
  type ScreeningRepository,
} from "../modules/lighttick/investments/screening/screen.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
const key = (o: LightTickOwner, ...keys: string[]) =>
  JSON.stringify([o.appId, o.userId, ...keys]);
export class InMemoryScreeningStore implements ScreeningRepository {
  private definitionsMap = new Map<string, Definition[]>();
  private workMap = new Map<string, ScreenWork>();
  async definition(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    version?: number,
  ) {
    const rows = this.definitionsMap.get(key(o, kind, id));
    return structuredClone(
      version === undefined
        ? rows?.at(-1)
        : rows?.find((d) => d.revision === version),
    );
  }
  async definitions(o: LightTickOwner, kind: "rules" | "templates") {
    return structuredClone(
      [...this.definitionsMap]
        .filter(([k]) => k.startsWith(prefix(o)))
        .map(([, v]) => v.at(-1)!)
        .filter((d) => d.kind === kind)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 201),
    );
  }
  async versions(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    before: number,
    limit: number,
  ) {
    return structuredClone(
      (this.definitionsMap.get(key(o, kind, id)) ?? [])
        .filter((d) => d.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async saveDefinition(o: LightTickOwner, d: Definition, base: number) {
    const k = key(o, d.kind, d.id),
      rows = this.definitionsMap.get(k) ?? [];
    if ((rows.at(-1)?.revision ?? 0) !== base) fail(409, "Definition changed.");
    this.definitionsMap.set(k, [...rows, structuredClone(d)]);
  }
  async work(o: LightTickOwner, id: string) {
    return structuredClone(this.workMap.get(key(o, id)));
  }
  async works(o: LightTickOwner) {
    return [...this.workMap]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => workSummary(v))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 101);
  }
  async saveWork(w: ScreenWork, base: number) {
    const k = key(w, w.id);
    if ((this.workMap.get(k)?.revision ?? 0) !== base)
      fail(409, "Work changed.");
    this.workMap.set(k, structuredClone(w));
  }
  async recoverable(now: string) {
    const owners = new Set<string>();
    return structuredClone(
      [...this.workMap.values()]
        .filter(
          (w) =>
            w.status === "queued" ||
            (w.status === "running" && w.lease_until! <= now),
        )
        .sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
        .filter((w) => {
          const k = prefix(w);
          if (owners.has(k)) return false;
          owners.add(k);
          return true;
        })
        .slice(0, 100),
    );
  }
  snapshot() {
    return structuredClone({
      definitions: [...this.definitionsMap],
      work: [...this.workMap],
    });
  }
  restore(v: ReturnType<InMemoryScreeningStore["snapshot"]>) {
    this.definitionsMap = new Map(v.definitions);
    this.workMap = new Map(v.work);
  }
  deleteOwner(o: LightTickOwner) {
    for (const map of [this.definitionsMap, this.workMap])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
}
