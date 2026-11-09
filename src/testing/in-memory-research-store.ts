import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  researchSummary,
  type ResearchEntry,
  type ResearchRepository,
} from "../modules/lighttick/investments/research/research.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryResearchStore implements ResearchRepository {
  private entries = new Map<string, ResearchEntry[]>();
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.entries.get(key(o, id))?.at(-1));
  }
  async list(o: LightTickOwner, instrument?: string) {
    return [...this.entries]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => v.at(-1)!)
      .filter((e) => !instrument || e.instrument_id === instrument)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 501)
      .map(researchSummary);
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return structuredClone(
      (this.entries.get(key(o, id)) ?? [])
        .filter((v) => v.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async save(o: LightTickOwner, e: ResearchEntry, base: number) {
    const k = key(o, e.id),
      versions = this.entries.get(k) ?? [];
    if ((versions.at(-1)?.revision ?? 0) !== base)
      fail(409, "Research changed.");
    this.entries.set(k, [...versions, structuredClone(e)]);
  }
  snapshot() {
    return structuredClone([...this.entries]);
  }
  restore(v: ReturnType<InMemoryResearchStore["snapshot"]>) {
    this.entries = new Map(v);
  }
  deleteOwner(o: LightTickOwner) {
    for (const k of this.entries.keys())
      if (k.startsWith(prefix(o))) this.entries.delete(k);
  }
}
