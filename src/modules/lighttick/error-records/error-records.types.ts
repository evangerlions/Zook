import type { LightTickOwner } from "../lighttick.types.ts";
export interface ErrorCategory {
  id: string;
  version: number;
  name: string;
  description: string;
  builtin: boolean;
}
export interface ErrorRecord {
  id: string;
  version: number;
  date: string;
  module_id: string;
  category_id: string;
  description: string;
  severity: number;
  context: string;
  improvement_action: string;
  is_repeat: boolean;
  related_error_id: string | null;
  archived: boolean;
  created_at: string;
  updated_at: string;
}
export interface ErrorQuery {
  date_from: string;
  date_to: string;
  module_id: string;
  category_id: string;
  repeat: "" | "true" | "false";
  archived: boolean;
  q: string;
  page: number;
  page_size: number;
}
export interface ErrorStats {
  total: number;
  repeated: number;
  repeat_rate: number | null;
  severity_avg: number | null;
  categories: { category_id: string; count: number }[];
  daily: { date: string; count: number }[];
}
export interface ErrorPage {
  items: ErrorRecord[];
  total: number;
  page: number;
  page_size: number;
  filters: ErrorQuery;
  stats: ErrorStats;
}
export interface ErrorRecordsStore {
  lookup(
    o: LightTickOwner,
    q: string,
    page: number,
  ): Promise<{
    items: ErrorRecord[];
    total: number;
    page: number;
    page_size: number;
  }>;
  get(o: LightTickOwner, id: string): Promise<ErrorRecord | undefined>;
  save(o: LightTickOwner, row: ErrorRecord, base: number): Promise<void>;
  list(o: LightTickOwner, q: ErrorQuery): Promise<ErrorPage>;
  linked(
    o: LightTickOwner,
    id: string,
    after: string,
    limit: number,
  ): Promise<{
    items: ErrorRecord[];
    total: number;
    next_cursor: string | null;
  }>;
  categories(o: LightTickOwner): Promise<ErrorCategory[]>;
  saveCategory(
    o: LightTickOwner,
    row: ErrorCategory,
    base: number,
  ): Promise<void>;
  deleteCategory(o: LightTickOwner, id: string, base: number): Promise<void>;
  categoryUsage(o: LightTickOwner, id: string): Promise<number>;
}
export const DEFAULT_ERROR_CATEGORIES: ErrorCategory[] = [
  ["bias", "判断偏差", "高估或低估条件或重要性"],
  ["omission", "步骤遗漏", "执行中遗漏关键步骤"],
  ["confusion", "概念混淆", "对概念的理解有偏差"],
  ["distraction", "注意力分散", "执行时注意力分散"],
  ["estimation", "时间估算错误", "时间估算与实际不符"],
  ["communication", "沟通误解", "沟通理解存在偏差"],
  ["overconfidence", "过度自信", "自评与可见结果不符"],
  ["other", "其他", "其他本人记录的错误"],
].map(([id, name, description]) => ({
  id: "builtin-" + id,
  name,
  description,
  version: 1,
  builtin: true,
}));
export function aggregateErrorRows(rows: ErrorRecord[]): ErrorStats {
  const repeated = rows.filter((r) => r.is_repeat).length,
    c = new Map<string, number>(),
    d = new Map<string, number>();
  for (const r of rows) {
    c.set(r.category_id, (c.get(r.category_id) ?? 0) + 1);
    d.set(r.date, (d.get(r.date) ?? 0) + 1);
  }
  return {
    total: rows.length,
    repeated,
    repeat_rate: rows.length
      ? Math.round((repeated / rows.length) * 10000) / 10000
      : null,
    severity_avg: rows.length
      ? Math.round(
          (rows.reduce((n, r) => n + r.severity, 0) / rows.length) * 10,
        ) / 10
      : null,
    categories: [...c]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([category_id, count]) => ({ category_id, count })),
    daily: [...d]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, count]) => ({ date, count })),
  };
}
