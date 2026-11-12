import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { DomainNotifier } from "../modules/lighttick/domain-changes/domain-changes.types.ts";
import type {
  ExperienceObject,
  ExperienceKind,
  ExperienceTombstone,
  ExperienceQuery,
  ExperienceRepeated,
  ErrorData,
  ErrorTypeData,
  ApplicationData,
  ExperienceRepository,
  ExperienceSection,
  ExperienceExportRecord,
} from "../modules/lighttick/experience/experience.types.ts";
import { defaultErrorTypes } from "../modules/lighttick/experience/experience-catalog.ts";
import {
  experienceSummary,
  matchesExperience,
  experienceTextOrder,
} from "../modules/lighttick/experience/experience-projections.ts";
import { memoryExperienceAggregate } from "../modules/lighttick/experience/experience-statistics.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const prefix = (o: LightTickOwner) => JSON.stringify([o.appId, o.userId]) + ":";
const key = (o: LightTickOwner, kind: ExperienceKind, id: string) =>
  prefix(o) + JSON.stringify([kind, id]);
const copy = <T>(v: T): T => structuredClone(v);
export class InMemoryExperienceStore implements ExperienceRepository {
  private rows = new Map<string, ExperienceObject[]>();
  private tombstones = new Map<string, ExperienceTombstone>();
  constructor(
    readonly notify: DomainNotifier,
    readonly receipts: (
      o: LightTickOwner,
      id: string,
    ) => Promise<{ key: string; hash: string }[]> = async () => [],
    readonly redact: (
      o: LightTickOwner,
      id: string,
      now: string,
    ) => Promise<void> = async () => {},
    readonly exportReceipts: (
      o: LightTickOwner,
    ) => Promise<ExperienceExportRecord[]> = async () => [],
  ) {}
  async entries(
    o: LightTickOwner,
    section: ExperienceSection,
    after: string,
    limit: number,
  ): Promise<ExperienceExportRecord[]> {
    const records: ExperienceExportRecord[] =
      section === "receipts"
        ? await this.exportReceipts(o)
        : section === "tombstones"
          ? [...this.tombstones]
              .filter(([k]) => k.startsWith(prefix(o)))
              .map(([, r]) => ({
                key: JSON.stringify([r.kind, r.id]),
                value: r as unknown as Record<string, unknown>,
              }))
          : [...this.rows]
              .filter(([k]) => k.startsWith(prefix(o)))
              .flatMap(([, versions]) =>
                (section === "objects" ? [versions.at(-1)!] : versions).map(
                  (r) => ({
                    key: JSON.stringify(
                      section === "objects"
                        ? [r.kind, r.id]
                        : [r.kind, r.id, r.revision],
                    ),
                    value: r as unknown as Record<string, unknown>,
                  }),
                ),
              );
    return copy(
      records
        .filter((r) => r.key > after)
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .slice(0, limit),
    );
  }
  snapshot() {
    return copy({ rows: [...this.rows], tombstones: [...this.tombstones] });
  }
  restore(s: ReturnType<InMemoryExperienceStore["snapshot"]>) {
    this.rows = new Map(s.rows);
    this.tombstones = new Map(s.tombstones);
  }
  deleteOwner(o: LightTickOwner) {
    for (const map of [this.rows, this.tombstones])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
  async get(o: LightTickOwner, kind: ExperienceKind, id: string) {
    return copy(this.rows.get(key(o, kind, id))?.at(-1));
  }
  async tombstone(o: LightTickOwner, kind: ExperienceKind, id: string) {
    return copy(this.tombstones.get(key(o, kind, id)));
  }
  private objects(o: LightTickOwner) {
    const own = [...this.rows]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => v.at(-1)!);
    return [
      ...own,
      ...defaultErrorTypes.filter(
        (t) =>
          !this.rows.has(key(o, "error_type", t.id)) &&
          !this.tombstones.has(key(o, "error_type", t.id)),
      ),
    ];
  }
  async save(o: LightTickOwner, row: ExperienceObject, base: number) {
    const k = key(o, row.kind, row.id),
      old = this.rows.get(k) ?? [];
    if ((old.at(-1)?.revision ?? 0) !== base) fail(409, "记录已变化。");
    this.rows.set(k, [...old, copy(row)]);
    await this.notify(o, {
      domain: "experience",
      resource: row.kind,
      id: row.id,
      revision: row.revision,
      operation: "upsert",
    });
  }
  async page(o: LightTickOwner, q: ExperienceQuery) {
    return this.objects(o)
      .filter((r) => matchesExperience(r, q))
      .map(experienceSummary)
      .filter(
        (r) =>
          !q.after ||
          (q.after.date === null
            ? r.date === null && r.id < q.after.id
            : r.date === null ||
              r.date < q.after.date ||
              (r.date === q.after.date && r.id < q.after.id)),
      )
      .sort((a, b) =>
        a.date === b.date
          ? a.id > b.id
            ? -1
            : 1
          : a.date === null
            ? 1
            : b.date === null
              ? -1
              : a.date > b.date
                ? -1
                : 1,
      )
      .slice(0, q.limit);
  }
  async history(
    o: LightTickOwner,
    kind: ExperienceKind,
    id: string,
    before: number,
    limit: number,
  ) {
    return copy(
      (this.rows.get(key(o, kind, id)) ?? [])
        .filter((r) => r.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async typeNameUsed(o: LightTickOwner, name: string, except: string) {
    return this.objects(o).some(
      (r) =>
        r.kind === "error_type" &&
        r.id !== except &&
        !r.archived &&
        (r.data as ErrorTypeData).name === name,
    );
  }
  async scope(o: LightTickOwner, kind: ExperienceKind, id: string) {
    const name = (
      this.objects(o).find((r) => r.kind === kind && r.id === id)?.data as
        | ErrorTypeData
        | undefined
    )?.name;
    return {
      versions: this.rows.get(key(o, kind, id))?.length ?? 0,
      references: this.objects(o).filter((r) => {
        if (r.kind !== "error") return false;
        const d = r.data as ErrorData;
        return kind === "error"
          ? d.related_error_id === id
          : kind === "error_type" &&
              (d.type_id === id ||
                (d.type_id === null && d.error_type === name));
      }).length,
      receipts: await this.receipts(o, id),
    };
  }
  async erase(o: LightTickOwner, t: ExperienceTombstone) {
    this.rows.delete(key(o, t.kind, t.id));
    this.tombstones.set(key(o, t.kind, t.id), copy(t));
    await this.redact(o, t.id, t.deleted_at);
    await this.notify(o, {
      domain: "experience",
      resource: t.kind,
      id: t.id,
      revision: t.revision,
      operation: "delete",
    });
  }
  async aggregate(
    o: LightTickOwner,
    q: ExperienceQuery,
    start: string,
    end: string,
  ) {
    return memoryExperienceAggregate(
      this.objects(o).filter((r) => matchesExperience(r, q, false)),
      start,
      end,
    );
  }
  async repeated(o: LightTickOwner, q: ExperienceQuery) {
    const groups = new Map<string, ExperienceRepeated>();
    for (const r of this.objects(o).filter((r) => matchesExperience(r, q))) {
      const d = r.data as ErrorData;
      const g = groups.get(d.error_type) ?? {
        error_type: d.error_type,
        count: 0,
        first_occurrence: null,
        last_occurrence: null,
        unknown_dates: 0,
      };
      g.count++;
      if (d.date === null) g.unknown_dates++;
      else {
        if (g.first_occurrence === null || d.date < g.first_occurrence)
          g.first_occurrence = d.date;
        if (g.last_occurrence === null || d.date > g.last_occurrence)
          g.last_occurrence = d.date;
      }
      groups.set(g.error_type, g);
    }
    return [...groups.values()]
      .filter(
        (g) =>
          g.count >= 2 &&
          (!q.after ||
            g.count < q.after.count! ||
            (g.count === q.after.count &&
              experienceTextOrder(g.error_type, q.after.id) > 0)),
      )
      .sort(
        (a, b) =>
          b.count - a.count || experienceTextOrder(a.error_type, b.error_type),
      )
      .slice(0, q.limit);
  }
  async concepts(o: LightTickOwner, after: string, limit: number) {
    return [
      ...new Set(
        this.objects(o)
          .filter((r) => r.kind === "application" && !r.archived)
          .map((r) => (r.data as ApplicationData).concept),
      ),
    ]
      .filter((c) => experienceTextOrder(c, after) > 0)
      .sort(experienceTextOrder)
      .slice(0, limit);
  }
}
