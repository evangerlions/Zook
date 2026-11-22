import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  FocusRepository,
  FocusRow,
  FocusPreferences,
} from "../modules/lighttick/focus/focus.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id = "") =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryFocusStore implements FocusRepository {
  private rows = new Map<string, FocusRow>();
  private prefs = new Map<string, FocusPreferences>();
  async preferences(o: LightTickOwner) {
    return structuredClone(this.prefs.get(key(o)));
  }
  async savePreferences(
    o: LightTickOwner,
    row: FocusPreferences,
    base: number,
  ) {
    if ((this.prefs.get(key(o))?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "计时设置已变化。",
      );
    this.prefs.set(key(o), structuredClone(row));
  }
  async active(o: LightTickOwner) {
    return structuredClone(
      [...this.rows.values()].find(
        (r) =>
          r.appId === o.appId &&
          r.userId === o.userId &&
          ["running", "paused"].includes(r.status),
      ),
    );
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id)));
  }
  async save(row: FocusRow, base: number) {
    const k = key(row, row.id);
    if ((this.rows.get(k)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "计时已变化。",
      );
    if (
      ["running", "paused"].includes(row.status) &&
      [...this.rows.values()].some(
        (r) =>
          r.appId === row.appId &&
          r.userId === row.userId &&
          r.id !== row.id &&
          ["running", "paused"].includes(r.status),
      )
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "已有当前计时。",
      );
    this.rows.set(k, structuredClone(row));
  }
  async history(
    o: LightTickOwner,
    offset: number,
    limit: number,
    kind = "all",
  ) {
    const rows = [...this.rows.values()]
      .filter(
        (r) =>
          r.appId === o.appId &&
          r.userId === o.userId &&
          !["running", "paused"].includes(r.status) &&
          (kind === "all" || r.kind === kind),
      )
      .sort(
        (a, b) =>
          b.started_at.localeCompare(a.started_at) || a.id.localeCompare(b.id),
      );
    return {
      items: structuredClone(rows.slice(offset, offset + limit)),
      total: rows.length,
    };
  }
  async summary(o: LightTickOwner, start: string, end: string) {
    const rows = [...this.rows.values()].filter(
      (r) =>
        r.appId === o.appId &&
        r.userId === o.userId &&
        r.status === "saved" &&
        r.kind === "focus" &&
        (r.actual_seconds ?? 0) > 0 &&
        r.business_date >= start &&
        r.business_date <= end,
    );
    return {
      sessions: rows.length,
      seconds: rows.reduce((s, r) => s + r.actual_seconds!, 0),
      days: new Set(rows.map((r) => r.business_date)).size,
      dates: [...new Set(rows.map((r) => r.business_date))].sort(),
    };
  }
  snapshot() {
    return structuredClone({ rows: [...this.rows], prefs: [...this.prefs] });
  }
  restore(value: ReturnType<InMemoryFocusStore["snapshot"]>) {
    this.rows = new Map(value.rows);
    this.prefs = new Map(value.prefs);
  }
  deleteOwner(o: LightTickOwner) {
    this.prefs.delete(key(o));
    for (const [k, r] of this.rows)
      if (r.appId === o.appId && r.userId === o.userId) this.rows.delete(k);
  }
}
