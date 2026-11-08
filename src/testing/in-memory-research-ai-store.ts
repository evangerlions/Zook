import type {
  ResearchAIWork,
  ResearchAIRepository,
} from "../modules/lighttick/investments/research-ai/research-ai.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryResearchAIStore implements ResearchAIRepository {
  private rows = new Map<string, ResearchAIWork>();
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id)));
  }
  async save(w: ResearchAIWork, base: number) {
    if ((this.rows.get(key(w, w.id))?.revision ?? 0) !== base)
      fail(409, "Research AI changed");
    this.rows.set(key(w, w.id), structuredClone(w));
  }
  async list(o: LightTickOwner) {
    return structuredClone(
      [...this.rows.values()]
        .filter((w) => w.appId === o.appId && w.userId === o.userId)
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
    );
  }
  async recoverable(now: string) {
    const owners = new Set<string>();
    return structuredClone(
      [...this.rows.values()]
        .filter(
          (w) =>
            w.status === "queued" ||
            (w.status === "running" && w.lease_until! <= now),
        )
        .filter((w) => {
          const k = key(w, "");
          if (owners.has(k)) return false;
          owners.add(k);
          return true;
        })
        .slice(0, 100),
    );
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryResearchAIStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, w] of this.rows)
      if (w.appId === o.appId && w.userId === o.userId) this.rows.delete(k);
  }
}
