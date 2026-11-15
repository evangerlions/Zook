import type {
  TodayFocusRepository,
  TodayFocusRow,
} from "../modules/lighttick/today-focus/today-focus.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, date: string) =>
  JSON.stringify([o.appId, o.userId, date]);
export class InMemoryTodayFocusStore implements TodayFocusRepository {
  private rows = new Map<string, TodayFocusRow>();
  async get(o: LightTickOwner, date: string) {
    return structuredClone(this.rows.get(key(o, date)));
  }
  async save(row: TodayFocusRow, base: number) {
    const k = key(row, row.business_date);
    if ((this.rows.get(k)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "今日焦点已变化。",
      );
    this.rows.set(k, structuredClone(row));
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryTodayFocusStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, r] of this.rows)
      if (r.appId === o.appId && r.userId === o.userId) this.rows.delete(k);
  }
}
