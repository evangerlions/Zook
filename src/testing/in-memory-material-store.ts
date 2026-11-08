import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  materialSummary,
  type Material,
  type MaterialRepository,
} from "../modules/lighttick/investments/materials/material.types.ts";
import type { ResearchRepository } from "../modules/lighttick/investments/research/research.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryMaterialStore implements MaterialRepository {
  private entries = new Map<string, Material[]>();
  constructor(readonly research: ResearchRepository) {}
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.entries.get(key(o, id))?.at(-1));
  }
  async version(o: LightTickOwner, id: string, revision: number) {
    return structuredClone(
      this.entries.get(key(o, id))?.find((m) => m.revision === revision),
    );
  }
  async list(o: LightTickOwner) {
    return [...this.entries]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => materialSummary(v.at(-1)!))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 501);
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return structuredClone(
      (this.entries.get(key(o, id)) ?? [])
        .filter((m) => m.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async references(o: LightTickOwner, id: string) {
    const result = [];
    for (const r of await this.research.list(o)) {
      const e = await this.research.get(o, r.id),
        s = e?.material_sources?.find((s) => s.id === id);
      if (s)
        result.push({
          research_id: r.id,
          research_revision: r.revision,
          title: r.title,
          instrument_id: r.instrument_id,
          archived: r.archived,
          material_version: s.version,
        });
    }
    return result;
  }
  async save(o: LightTickOwner, m: Material, base: number) {
    const k = key(o, m.id),
      rows = this.entries.get(k) ?? [];
    if ((rows.at(-1)?.revision ?? 0) !== base) fail(409, "Material changed.");
    this.entries.set(k, [...rows, structuredClone(m)]);
  }
  snapshot() {
    return structuredClone([...this.entries]);
  }
  restore(v: ReturnType<InMemoryMaterialStore["snapshot"]>) {
    this.entries = new Map(v);
  }
  deleteOwner(o: LightTickOwner) {
    for (const k of this.entries.keys())
      if (k.startsWith(prefix(o))) this.entries.delete(k);
  }
}
