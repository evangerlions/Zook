import { randomUUID } from "node:crypto";
import type { LightTickOwner } from "../../lighttick.types.ts";
import { digest, fail } from "../../learning/native-learning.validation.ts";
import { ObservationWorkService } from "./observation.work-service.ts";
import { OBS_LIMITS } from "./observation.service.ts";
import { evaluatePrediction, checkMonitor } from "./observation.engine.ts";
import { rowDigest } from "./observation.validation.ts";
import type {
  Observation,
  ObservationWork,
  CheckReport,
  EvaluationReport,
  EvaluationInput,
  CheckInput,
  MonitorFields,
} from "./observation.types.ts";
export class ObservationRunner {
  constructor(
    readonly service: ObservationWorkService,
    readonly authorizeOwner: (
      o: LightTickOwner,
    ) => Promise<void> = async () => {},
    readonly compute = async (w: ObservationWork, signal: AbortSignal) =>
      w.kind === "evaluation"
        ? evaluatePrediction(w.input as EvaluationInput, signal)
        : checkMonitor(w.input as CheckInput, signal),
  ) {}
  async recover() {
    const s = this.service,
      now = s.clock().toISOString(),
      rows = await s.store.recoverable(now);
    for (const w of rows) await s.dispatch(w, w.id);
    let scheduled = 0;
    for (const row of await s.store.due(now)) {
      const owner = { appId: row.appId, userId: row.userId };
      try {
        await this.authorizeOwner(owner);
        const m = await s.store.get(owner, "monitors", row.id);
        if (!m || m.archived || !(m.fields as MonitorFields).enabled) continue;
        const slot = Math.floor(
          s.clock().getTime() /
            ((m.fields as MonitorFields).interval_seconds * 1000),
        );
        await s.createWork(
          owner,
          "check",
          m.id,
          { base_revision: m.revision, consent: true },
          "observe-auto-" +
            digest([owner, m.id, m.revision, slot]).slice(0, 40),
        );
        scheduled++;
      } catch (error) {
        await s.repo.transaction(owner, async () => {
          const m = await s.store.get(owner, "monitors", row.id);
          if (m?.runtime)
            await s.store.updateRuntime(owner, row.id, {
              ...m.runtime,
              next_at: new Date(s.clock().getTime() + 300000).toISOString(),
              last_error:
                (error as any).statusCode === 429
                  ? "BUDGET_EXHAUSTED"
                  : (error as any).statusCode === 413
                    ? "CAPACITY_EXHAUSTED"
                    : "SCHEDULE_DEFERRED",
            });
        });
      }
    }
    return rows.length + scheduled;
  }
  async execute(o: LightTickOwner, id: string) {
    const s = this.service,
      store = s.store,
      now = () => s.clock().toISOString();
    const claim = await s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        !["queued", "running"].includes(w.status) ||
        (w.status === "running" && w.lease_until! > now())
      )
        return;
      let error: string | null = null;
      try {
        await this.authorizeOwner(o);
        await s.context(o, w.kind, w.input);
      } catch {
        error = "OBSERVATION_PERMISSION_OR_CONTEXT_CHANGED";
      }
      if (w.attempt >= OBS_LIMITS.attempts) error = "RECOVERY_EXHAUSTED";
      if (error) {
        await store.saveWork(
          {
            ...w,
            revision: w.revision + 1,
            status: "failed",
            error_code: error,
            fence: null,
            lease_until: null,
            updated_at: now(),
          },
          w.revision,
        );
        return;
      }
      const n = {
        ...w,
        revision: w.revision + 1,
        status: "running" as const,
        attempt: w.attempt + 1,
        fence: randomUUID(),
        lease_until: new Date(
          s.clock().getTime() + OBS_LIMITS.lease_ms,
        ).toISOString(),
        updated_at: now(),
      };
      await store.saveWork(n, w.revision);
      return n;
    });
    if (!claim) return;
    const abort = new AbortController();
    let output: CheckReport | EvaluationReport | null = null,
      error: string | null = null,
      polling = false;
    const check = () =>
      s.repo.transaction(o, async () => {
        await this.authorizeOwner(o);
        const w = await store.work(o, id);
        if (
          !w ||
          w.status !== "running" ||
          w.fence !== claim.fence ||
          w.lease_until! <= now()
        )
          throw Error("STALE");
        await s.context(o, claim.kind, claim.input);
      });
    const timer = setTimeout(() => abort.abort(), OBS_LIMITS.timeout_ms),
      poll = setInterval(() => {
        if (polling) return;
        polling = true;
        void check()
          .catch(() => abort.abort())
          .finally(() => (polling = false));
      }, 250);
    try {
      await check();
      output = await Promise.race([
        this.compute(claim, abort.signal),
        new Promise<never>((_, reject) => {
          abort.signal.addEventListener(
            "abort",
            () => reject(Error("CANCELLED_OR_TIMEOUT")),
            { once: true },
          );
          if (abort.signal.aborted) reject(Error("CANCELLED_OR_TIMEOUT"));
        }),
      ]);
      await check();
    } catch {
      error = abort.signal.aborted
        ? "CANCELLED_OR_TIMEOUT"
        : "OBSERVATION_INPUT_OR_PERMISSION_CHANGED";
    } finally {
      clearTimeout(timer);
      clearInterval(poll);
      abort.abort();
    }
    return s.repo.transaction(o, async () => {
      const w = await store.work(o, id);
      if (
        !w ||
        w.status !== "running" ||
        w.fence !== claim.fence ||
        w.lease_until! <= now()
      )
        return;
      try {
        await this.authorizeOwner(o);
        await s.context(o, claim.kind, claim.input);
      } catch {
        error = "OBSERVATION_INPUT_OR_PERMISSION_CHANGED";
      }
      let event_id: string | null = null,
        event_disposition: string | null = null;
      if (!error && output?.kind === "check") {
        const m = (await store.get(
            o,
            "monitors",
            w.resource_id,
          )) as Observation<"monitors">,
          runtime = { ...m.runtime! };
        if (output.state === "triggered") {
          const deduplication_key = digest([
            m.id,
            m.revision,
            output.source_time,
          ]);
          if (runtime.last_source === deduplication_key)
            event_disposition = "duplicate";
          else if (
            runtime.last_triggered_at &&
            Date.parse(now()) - Date.parse(runtime.last_triggered_at) <
              m.fields.cooldown_seconds * 1000
          )
            event_disposition = "cooldown";
          else {
            event_id = "inv-event-" + deduplication_key.slice(0, 40);
            if (await store.get(o, "events", event_id)) {
              event_disposition = "duplicate";
              event_id = null;
            } else if (
              (await store.list(o, "events")).length >= OBS_LIMITS.events
            ) {
              error = "EVENT_CAPACITY_EXHAUSTED";
              event_id = null;
            } else {
              const event: Observation<"events"> = {
                id: event_id,
                kind: "events",
                revision: 1,
                request_key: w.request_key,
                archived: false,
                created_at: now(),
                updated_at: now(),
                fields: {
                  monitor_id: m.id,
                  monitor_version: m.revision,
                  work_id: w.id,
                  observation: output,
                  deduplication_key,
                  read: false,
                },
                digest: "",
              };
              event.digest = rowDigest(event);
              await store.save(o, event, 0);
              event_disposition = "created";
              runtime.last_source = deduplication_key;
              runtime.last_triggered_at = now();
            }
          }
        } else event_disposition = "not_triggered";
        await store.updateRuntime(o, m.id, {
          ...runtime,
          last_work_id: w.id,
          last_error: error,
        });
      }
      await store.saveWork(
        {
          ...w,
          revision: w.revision + 1,
          status: error ? "failed" : "succeeded",
          output: error ? null : output,
          error_code: error,
          event_id,
          event_disposition,
          fence: null,
          lease_until: null,
          updated_at: now(),
        },
        w.revision,
      );
    });
  }
}
