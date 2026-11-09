import { sourceKey } from "../modules/lighttick/knowledge/knowledge.types.ts";
import type {
  KnowledgeRepository,
  KnowledgeEntry,
  LearningFact,
} from "../modules/lighttick/knowledge/knowledge.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryKnowledgeStore implements KnowledgeRepository {
  private entries = new Map<string, KnowledgeEntry>();
  private versions = new Map<string, KnowledgeEntry[]>();
  constructor(
    readonly learningFacts: (o: LightTickOwner) => Promise<LearningFact[]>,
    readonly available: (
      o: LightTickOwner,
      s: import("../modules/lighttick/knowledge/knowledge.types.ts").KnowledgeSource,
    ) => Promise<boolean>,
  ) {}
  learningExport: KnowledgeRepository["learningExport"] = async () => ({
    publications: [],
    states: [],
    history: [],
  });
  async availableSources(
    o: LightTickOwner,
    sources: import("../modules/lighttick/knowledge/knowledge.types.ts").KnowledgeSource[],
  ) {
    const keys = [];
    for (const s of sources)
      if (await this.available(o, s)) keys.push(sourceKey(s));
    return keys;
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.entries.get(key(o, id)));
  }
  async list(o: LightTickOwner) {
    return structuredClone(
      [...this.entries]
        .filter(([k]) =>
          k.startsWith(JSON.stringify([o.appId, o.userId]).slice(0, -1) + ","),
        )
        .map(([, v]) => v)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 5001),
    );
  }
  async history(o: LightTickOwner, id: string, before: number, limit: number) {
    return structuredClone(
      (this.versions.get(key(o, id)) ?? [])
        .filter((e) => e.revision < before)
        .sort((a, b) => b.revision - a.revision)
        .slice(0, limit),
    );
  }
  async save(o: LightTickOwner, e: KnowledgeEntry, base: number) {
    const k = key(o, e.id);
    if ((this.entries.get(k)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Knowledge changed.",
      );
    this.entries.set(k, structuredClone(e));
    this.versions.set(k, [...(this.versions.get(k) ?? []), structuredClone(e)]);
  }
  snapshot() {
    return structuredClone({
      entries: [...this.entries],
      versions: [...this.versions],
    });
  }
  restore(v: ReturnType<InMemoryKnowledgeStore["snapshot"]>) {
    this.entries = new Map(v.entries);
    this.versions = new Map(v.versions);
  }
  deleteOwner(o: LightTickOwner) {
    for (const k of this.entries.keys())
      if (
        k.startsWith(JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",")
      ) {
        this.entries.delete(k);
        this.versions.delete(k);
      }
  }
}
