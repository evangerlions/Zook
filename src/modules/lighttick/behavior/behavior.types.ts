import type { LightTickOwner } from "../lighttick.types.ts";
export interface BehaviorRow {
  id: string;
  version: number;
  date: string;
  module_id: string;
  concept: string;
  scenario: string;
  effectiveness: number;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface BehaviorQuery {
  date_from: string;
  date_to: string;
  module_id: string;
  concept: string;
  q: string;
  archived: boolean;
  page: number;
}
export interface BehaviorStats {
  total: number;
  rated_count: number;
  effectiveness_avg: number | null;
  modules: { module_id: string; count: number }[];
  concepts: { concept: string; count: number }[];
  daily: { date: string; count: number }[];
}
export interface BehaviorStore {
  get(o: LightTickOwner, id: string): Promise<BehaviorRow | undefined>;
  save(o: LightTickOwner, r: BehaviorRow, base: number): Promise<void>;
  list(
    o: LightTickOwner,
    q: BehaviorQuery,
  ): Promise<{
    items: BehaviorRow[];
    total: number;
    page: number;
    page_size: number;
    stats: BehaviorStats;
  }>;
  concepts(
    o: LightTickOwner,
    q: string,
    page: number,
  ): Promise<{
    items: { concept: string; count: number }[];
    total: number;
    page: number;
    page_size: number;
  }>;
}
export function behaviorStats(rows: BehaviorRow[]): BehaviorStats {
  const group = (key: "module_id" | "concept" | "date") => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(r[key], (m.get(r[key]) ?? 0) + 1);
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  };
  const rated = rows.filter((r) => r.effectiveness > 0);
  return {
    total: rows.length,
    rated_count: rated.length,
    effectiveness_avg: rated.length
      ? rated.reduce((n, r) => n + r.effectiveness, 0) / rated.length
      : null,
    modules: group("module_id").map(([module_id, count]) => ({
      module_id,
      count,
    })),
    concepts: group("concept")
      .slice(0, 5)
      .map(([concept, count]) => ({ concept, count })),
    daily: group("date")
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, count]) => ({ date, count })),
  };
}
