import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  workSummary,
  type StrategyRepository,
  type StrategyDefinition,
  type BacktestWork,
} from "../modules/lighttick/investments/strategies/strategy.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryStrategyStore implements StrategyRepository {
  private defs = new Map<string, StrategyDefinition[]>();
  private runs = new Map<string, BacktestWork>();
  async definition(o: LightTickOwner, id: string, version?: number) {
    const rows = this.defs.get(key(o, id));
    return structuredClone(
      version === undefined
        ? rows?.at(-1)
        : rows?.find((d) => d.revision === version),
    );
  }
  async definitions(o: LightTickOwner) {
    return structuredClone(
      [...this.defs]
        .filter(([k]) => k.startsWith(prefix(o)))
        .map(([, v]) => v.at(-1)!)
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 201),
    );
  }
  async versions(o: LightTickOwner, id: string, before: number, limit: number) {
    return structuredClone(
      (this.defs.get(key(o, id)) ?? [])
        .filter((d) => d.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async saveDefinition(o: LightTickOwner, d: StrategyDefinition, base: number) {
    const k = key(o, d.id),
      rows = this.defs.get(k) ?? [];
    if ((rows.at(-1)?.revision ?? 0) !== base) fail(409, "Strategy changed.");
    this.defs.set(k, [...rows, structuredClone(d)]);
  }
  async work(o: LightTickOwner, id: string) {
    return structuredClone(this.runs.get(key(o, id)));
  }
  async works(o: LightTickOwner) {
    return [...this.runs]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, w]) => workSummary(w))
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 101);
  }
  async saveWork(w: BacktestWork, base: number) {
    const k = key(w, w.id);
    if ((this.runs.get(k)?.revision ?? 0) !== base)
      fail(409, "Backtest changed.");
    this.runs.set(k, structuredClone(w));
  }
  async recoverable(now: string) {
    const owners = new Set<string>();
    return structuredClone(
      [...this.runs.values()]
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
    return structuredClone({ defs: [...this.defs], runs: [...this.runs] });
  }
  restore(v: ReturnType<InMemoryStrategyStore["snapshot"]>) {
    this.defs = new Map(v.defs);
    this.runs = new Map(v.runs);
  }
  deleteOwner(o: LightTickOwner) {
    for (const m of [this.defs, this.runs])
      for (const k of m.keys()) if (k.startsWith(prefix(o))) m.delete(k);
  }
}
