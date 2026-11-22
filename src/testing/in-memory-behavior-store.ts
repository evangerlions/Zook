import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  behaviorStats,
  type BehaviorRow,
  type BehaviorQuery,
  type BehaviorStore,
} from "../modules/lighttick/behavior/behavior.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryBehaviorStore implements BehaviorStore {
  private rows = new Map<string, { o: LightTickOwner; r: BehaviorRow }>();
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryBehaviorStore["snapshot"]>) {
    this.rows = new Map(structuredClone(rows));
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, v] of this.rows)
      if (v.o.appId === o.appId && v.o.userId === o.userId) this.rows.delete(k);
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id))?.r);
  }
  async save(o: LightTickOwner, r: BehaviorRow, base: number) {
    if ((this.rows.get(key(o, r.id))?.r.version ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "应用记录已变化。",
      );
    this.rows.set(key(o, r.id), structuredClone({ o, r }));
  }
  owned(o: LightTickOwner) {
    return [...this.rows.values()]
      .filter((v) => v.o.appId === o.appId && v.o.userId === o.userId)
      .map((v) => v.r);
  }
  async list(o: LightTickOwner, q: BehaviorQuery) {
    const rows = this.owned(o)
        .filter(
          (r) =>
            r.archived === q.archived &&
            r.date >= q.date_from &&
            r.date <= q.date_to &&
            (!q.module_id || q.module_id === r.module_id) &&
            (!q.concept || q.concept === r.concept) &&
            (!q.q ||
              (r.concept + " " + r.scenario)
                .toLowerCase()
                .includes(q.q.toLowerCase())),
        )
        .sort(
          (a, b) =>
            b.date.localeCompare(a.date) ||
            b.created_at.localeCompare(a.created_at) ||
            a.id.localeCompare(b.id),
        ),
      page = Math.min(q.page, Math.max(1, Math.ceil(rows.length / 20)));
    return structuredClone({
      items: rows.slice((page - 1) * 20, page * 20),
      total: rows.length,
      page,
      page_size: 20,
      stats: behaviorStats(rows),
    });
  }
  async concepts(o: LightTickOwner, q: string, requested: number) {
    const groups = new Map<string, number>();
    for (const r of this.owned(o))
      if (!r.archived && r.concept.toLowerCase().includes(q.toLowerCase()))
        groups.set(r.concept, (groups.get(r.concept) ?? 0) + 1);
    const rows = [...groups]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([concept, count]) => ({ concept, count })),
      page = Math.min(requested, Math.max(1, Math.ceil(rows.length / 20)));
    return {
      items: rows.slice((page - 1) * 20, page * 20),
      total: rows.length,
      page,
      page_size: 20,
    };
  }
}
