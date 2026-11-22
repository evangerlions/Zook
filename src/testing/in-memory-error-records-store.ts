import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import {
  aggregateErrorRows,
  type ErrorRecordsStore,
  type ErrorRecord,
  type ErrorCategory,
  type ErrorQuery,
} from "../modules/lighttick/error-records/error-records.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
    JSON.stringify([o.appId, o.userId, id]),
  prefix = (o: LightTickOwner) =>
    JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryErrorRecordsStore implements ErrorRecordsStore {
  private records = new Map<string, ErrorRecord>();
  private types = new Map<string, ErrorCategory>();
  async lookup(o: LightTickOwner, q: string, page: number) {
    const all = [...this.records]
        .filter(
          ([k, r]) =>
            k.startsWith(prefix(o)) &&
            !r.archived &&
            r.description.toLowerCase().includes(q.toLowerCase()),
        )
        .map(([, r]) => r)
        .sort(
          (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
        ),
      total = all.length,
      current = Math.min(page, Math.max(1, Math.ceil(total / 10)));
    return structuredClone({
      items: all.slice((current - 1) * 10, current * 10),
      total,
      page: current,
      page_size: 10,
    });
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.records.get(key(o, id)));
  }
  async save(o: LightTickOwner, r: ErrorRecord, base: number) {
    const k = key(o, r.id);
    if ((this.records.get(k)?.version ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "错误记录已变化。",
      );
    this.records.set(k, structuredClone(r));
  }
  async list(o: LightTickOwner, q: ErrorQuery) {
    const all = [...this.records]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, r]) => r)
      .filter(
        (r) =>
          r.date >= q.date_from &&
          r.date <= q.date_to &&
          r.archived === q.archived &&
          (!q.module_id || r.module_id === q.module_id) &&
          (!q.category_id || r.category_id === q.category_id) &&
          (!q.repeat || r.is_repeat === (q.repeat === "true")) &&
          [r.description, r.context, r.improvement_action]
            .join(" ")
            .toLowerCase()
            .includes(q.q.toLowerCase()),
      )
      .sort(
        (a, b) =>
          b.date.localeCompare(a.date) ||
          b.created_at.localeCompare(a.created_at) ||
          a.id.localeCompare(b.id),
      );
    const total = all.length,
      page = Math.min(q.page, Math.max(1, Math.ceil(total / q.page_size)));
    return structuredClone({
      items: all.slice((page - 1) * q.page_size, page * q.page_size),
      total,
      page,
      page_size: q.page_size,
      filters: { ...q, page },
      stats: aggregateErrorRows(all),
    });
  }
  async linked(o: LightTickOwner, id: string, after: string, limit: number) {
    const all = [...this.records]
        .filter(
          ([k, r]) => k.startsWith(prefix(o)) && r.related_error_id === id,
        )
        .map(([, r]) => r)
        .sort((a, b) => a.id.localeCompare(b.id)),
      rows = all.filter((r) => r.id > after);
    return structuredClone({
      total: all.length,
      items: rows.slice(0, limit),
      next_cursor: rows.length > limit ? rows[limit - 1].id : null,
    });
  }
  async categories(o: LightTickOwner) {
    return structuredClone(
      [...this.types]
        .filter(([k]) => k.startsWith(prefix(o)))
        .map(([, t]) => t),
    );
  }
  async saveCategory(o: LightTickOwner, t: ErrorCategory, base: number) {
    const k = key(o, t.id);
    if ((this.types.get(k)?.version ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "分类已变化。",
      );
    this.types.set(k, structuredClone(t));
  }
  async deleteCategory(o: LightTickOwner, id: string, base: number) {
    if (this.types.get(key(o, id))?.version !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "分类已变化。",
      );
    this.types.delete(key(o, id));
  }
  async categoryUsage(o: LightTickOwner, id: string) {
    return [...this.records].filter(
      ([k, r]) => k.startsWith(prefix(o)) && r.category_id === id,
    ).length;
  }
  snapshot() {
    return structuredClone({
      records: [...this.records],
      types: [...this.types],
    });
  }
  restore(s: ReturnType<InMemoryErrorRecordsStore["snapshot"]>) {
    this.records = new Map(s.records);
    this.types = new Map(s.types);
  }
  deleteOwner(o: LightTickOwner) {
    for (const map of [this.records, this.types])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
}
