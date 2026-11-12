import type { DomainNotifier } from "../modules/lighttick/domain-changes/domain-changes.types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingScheduleRepository,
  ReadingScheduleDay,
} from "../modules/lighttick/reading/reading-schedule.types.ts";
import type { ReadingPreferences } from "../modules/lighttick/reading/reading-preferences.types.ts";
import type { ReadingWork } from "../modules/lighttick/reading/reading-work.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]) + ":";
export class InMemoryReadingScheduleStore implements ReadingScheduleRepository {
  private rows = new Map<string, ReadingScheduleDay>();
  constructor(
    readonly preferences: () => [string, ReadingPreferences][],
    readonly work: (
      o: LightTickOwner,
      id: string,
    ) => Promise<ReadingWork | undefined>,
    readonly notify: DomainNotifier = async () => {},
  ) {}
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryReadingScheduleStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    for (const k of this.rows.keys())
      if (k.startsWith(prefix(o))) this.rows.delete(k);
  }
  async get(o: LightTickOwner, date: string) {
    return structuredClone(this.rows.get(prefix(o) + date));
  }
  async history(o: LightTickOwner, before: string, limit: number) {
    return structuredClone(
      [...this.rows]
        .filter(([k, r]) => k.startsWith(prefix(o)) && r.date < before)
        .map(([, r]) => r)
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, limit),
    );
  }
  async due(date: string, minute: number, now: string, limit: number) {
    const rows: { owner: LightTickOwner; next: string }[] = [];
    for (const [key, p] of this.preferences()) {
      if (!p.value.enabled || p.value.hour * 60 + p.value.minute > minute)
        continue;
      const [appId, userId] = JSON.parse(key),
        owner = { appId, userId } as LightTickOwner,
        day = await this.get(owner, date);
      if (day && (day.phase !== "pending" || day.next_at > now)) continue;
      if (day?.work_id) {
        const work = await this.work(owner, day.work_id);
        if (work && ["queued", "running"].includes(work.status)) continue;
      }
      rows.push({ owner, next: day?.next_at ?? "" });
    }
    return rows
      .sort(
        (a, b) =>
          a.next.localeCompare(b.next) ||
          a.owner.userId.localeCompare(b.owner.userId),
      )
      .slice(0, limit)
      .map((r) => r.owner);
  }
  async save(o: LightTickOwner, row: ReadingScheduleDay, base: number) {
    const key = prefix(o) + row.date;
    if ((this.rows.get(key)?.revision ?? 0) !== base)
      fail(409, "Reading daily state changed");
    this.rows.set(key, structuredClone(row));
    await this.notify(o, {
      domain: "reading",
      resource: "day",
      id: row.date,
      revision: row.revision,
      operation: "upsert",
    });
  }
}
