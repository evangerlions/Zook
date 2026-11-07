import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  Observation,
  ObservationKind,
  MonitorRuntime,
  ObservationWork,
  ObservationStore,
  WorkSummary,
} from "../modules/lighttick/investments/observations/observation.types.ts";
import { fail } from "../modules/lighttick/learning/native-learning.validation.ts";
const key = (o: LightTickOwner, ...ids: string[]) =>
  JSON.stringify([o.appId, o.userId, ...ids]);
const prefix = (o: LightTickOwner) =>
  JSON.stringify([o.appId, o.userId]).slice(0, -1) + ",";
export class InMemoryObservationStore implements ObservationStore {
  private rows = new Map<string, Observation[]>();
  private jobs = new Map<string, ObservationWork>();
  private runtime = new Map<string, MonitorRuntime>();
  async get(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    version?: number,
  ) {
    const rows = this.rows.get(key(o, kind, id)) ?? [],
      row =
        version === undefined
          ? rows.at(-1)
          : rows.find((r) => r.revision === version);
    if (!row) return;
    const clone = structuredClone(row);
    if (version === undefined && kind === "monitors")
      clone.runtime = structuredClone(
        this.runtime.get(key(o, id)) ?? row.runtime,
      );
    return clone;
  }
  async list(o: LightTickOwner, kind: ObservationKind) {
    const rows = [...this.rows]
      .filter(([k]) => k.startsWith(prefix(o)))
      .map(([, v]) => v.at(-1)!)
      .filter((r) => r.kind === kind)
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, 1001);
    return Promise.all(
      rows.map((r) =>
        this.get(o, kind, r.id).then((v) => {
          const copy = v!;
          delete copy.frozen;
          return copy;
        }),
      ),
    );
  }
  async versions(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    before: number,
    limit: number,
    viewOnly = false,
  ) {
    return structuredClone(
      (this.rows.get(key(o, kind, id)) ?? [])
        .filter((r) => r.revision < before)
        .reverse()
        .slice(0, limit)
        .map((row) => {
          const copy = structuredClone(row);
          if (viewOnly) delete copy.frozen;
          return copy;
        }),
    );
  }
  async save(o: LightTickOwner, r: Observation, base: number) {
    const k = key(o, r.kind, r.id),
      old = this.rows.get(k) ?? [];
    if ((old.at(-1)?.revision ?? 0) !== base) fail(409, "Observation changed.");
    this.rows.set(k, [...old, structuredClone(r)]);
    if (r.runtime) this.runtime.set(key(o, r.id), structuredClone(r.runtime));
  }
  async updateRuntime(o: LightTickOwner, id: string, runtime: MonitorRuntime) {
    this.runtime.set(key(o, id), structuredClone(runtime));
  }
  async work(o: LightTickOwner, id: string) {
    return structuredClone(this.jobs.get(key(o, id)));
  }
  async works(o: LightTickOwner): Promise<WorkSummary[]> {
    return structuredClone(
      [...this.jobs]
        .filter(([k]) => k.startsWith(prefix(o)))
        .map(([, w]) => ({
          id: w.id,
          sequence: w.sequence,
          kind: w.kind,
          revision: w.revision,
          resource_id: w.resource_id,
          status: w.status,
          attempt: w.attempt,
          error_code: w.error_code,
          created_at: w.created_at,
          updated_at: w.updated_at,
        }))
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, 301),
    );
  }
  async saveWork(w: ObservationWork, base: number) {
    const k = key(w, w.id);
    if ((this.jobs.get(k)?.revision ?? 0) !== base) fail(409, "Work changed.");
    this.jobs.set(k, structuredClone(w));
  }
  async recoverable(now: string) {
    const owners = new Set<string>();
    return structuredClone(
      [...this.jobs.values()]
        .filter(
          (w) =>
            w.status === "queued" ||
            (w.status === "running" && w.lease_until! <= now),
        )
        .sort(
          (a, b) =>
            a.created_at.localeCompare(b.created_at) ||
            a.id.localeCompare(b.id),
        )
        .filter((w) => {
          const k = key(w);
          if (owners.has(k)) return false;
          owners.add(k);
          return true;
        })
        .slice(0, 100),
    );
  }
  async calibrationRows(o: LightTickOwner) {
    return structuredClone(
      [...this.jobs]
        .filter(
          ([k, w]) =>
            k.startsWith(prefix(o)) &&
            w.status === "succeeded" &&
            w.kind === "evaluation",
        )
        .map(([, w]) => {
          const i =
            w.input as import("../modules/lighttick/investments/observations/observation.types.ts").EvaluationInput;
          return {
            prediction_id: w.resource_id,
            probability: i.prediction.fields.probability,
            as_of: i.as_of,
            decision_at: i.decision_at,
            sequence: w.sequence,
            outcomes: (
              w.output as import("../modules/lighttick/investments/observations/observation.types.ts").EvaluationReport
            ).outcomes,
          };
        }),
    );
  }
  async due(now: string) {
    const out: (LightTickOwner & { id: string })[] = [];
    for (const [k, rows] of this.rows) {
      const r = rows.at(-1)!;
      if (r.kind !== "monitors" || r.archived || !(r.fields as any).enabled)
        continue;
      const [appId, userId] = JSON.parse(k),
        runtime = this.runtime.get(key({ appId, userId }, r.id)) ?? r.runtime;
      if (runtime && runtime.next_at <= now)
        out.push({ appId, userId, id: r.id });
    }
    return out.sort((a, b) => a.id.localeCompare(b.id)).slice(0, 100);
  }
  snapshot() {
    return structuredClone({
      rows: [...this.rows],
      jobs: [...this.jobs],
      runtime: [...this.runtime],
    });
  }
  restore(v: ReturnType<InMemoryObservationStore["snapshot"]>) {
    this.rows = new Map(v.rows);
    this.jobs = new Map(v.jobs);
    this.runtime = new Map(v.runtime);
  }
  deleteOwner(o: LightTickOwner) {
    for (const map of [this.rows, this.jobs, this.runtime])
      for (const k of map.keys()) if (k.startsWith(prefix(o))) map.delete(k);
  }
}
