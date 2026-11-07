import type { JobQueue } from "../../../../infrastructure/queue/job-queue.ts";
import type { LightTickRepository } from "../../lighttick.repository.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import {
  keys,
  object,
  integer,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { investmentId } from "../investment.service.ts";
import { referenceCalendar } from "../market/market.calendar.ts";
import { marketDate, shanghaiClock } from "../market/market.validation.ts";
import { timestamp } from "../screening/screen.validation.ts";
import { page } from "../screening/screen.definitions.ts";
import { ObservationService, OBS_LIMITS } from "./observation.service.ts";
import { actionReview, sha } from "./observation.validation.ts";
import { scope } from "./observation.sources.ts";
import {
  OBSERVATION_ALGORITHM,
  publicObservationWork,
  type ObservationWork,
  type Observation,
  type EvaluationInput,
  type CheckInput,
  type PredictionFields,
  type PredictionFrozen,
  type MonitorFields,
} from "./observation.types.ts";
export const OBSERVATION_JOB = "lighttick.investment.observation";
export class ObservationWorkService extends ObservationService {
  constructor(
    repo: LightTickRepository,
    readonly queue: JobQueue,
    authorize = async () => {},
    clock = () => new Date(),
  ) {
    super(repo, authorize, clock);
  }
  async createWork(
    o: LightTickOwner,
    kind: "evaluation" | "check",
    rid: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(rid);
    keys(
      b,
      kind === "evaluation"
        ? [
            "base_revision",
            "as_of",
            "decision_at",
            "sources",
            "corporate_action_review",
            "consent",
          ]
        : ["base_revision", "snapshot_id", "input_digest", "consent"],
    );
    const base = integer(b.base_revision, 1, 100);
    if (b.consent !== true) fail(422, "Explicit reviewed execution required.");
    const id = "inv-observe-" + digest([o, key, kind, rid]).slice(0, 40);
    await this.command(
      o,
      key,
      "investment_observation_work",
      id,
      "create",
      b,
      async (now) => {
        const head = await this.store.get(
          o,
          kind === "evaluation" ? "predictions" : "monitors",
          rid,
        );
        if (!head || head.archived || head.revision !== base)
          fail(409, "Observation version/archive changed.");
        const works = await this.store.works(o);
        if (works.length >= OBS_LIMITS.works)
          fail(413, "Observation work retention capacity exhausted.");
        if (
          works.filter((w) => w.created_at.slice(0, 10) === now.slice(0, 10))
            .length >= OBS_LIMITS.daily ||
          works.filter((w) => ["queued", "running"].includes(w.status))
            .length >= OBS_LIMITS.active
        )
          fail(429, "Observation daily or active budget exhausted.");
        let frozen: any;
        if (kind === "evaluation") {
          const prediction = head as Observation<"predictions">,
            f = prediction.frozen as PredictionFrozen,
            as_of = marketDate(b.as_of),
            decision_at = timestamp(b.decision_at);
          if (
            Date.parse(decision_at) > Date.parse(now) ||
            as_of > shanghaiClock(new Date(decision_at)).slice(0, 10) ||
            Date.parse(decision_at) < Date.parse(f.registered_at) ||
            as_of < prediction.fields.baseline.date
          )
            fail(
              422,
              "Select a known nonfuture evaluation date/time after registration.",
            );
          if (!Array.isArray(b.sources) || b.sources.length > 20)
            fail(422, "At most 20 explicit snapshot sources.");
          const selections = b.sources.map((v) => {
            const r = object(v);
            keys(r, ["id", "input_digest"]);
            return {
              id: investmentId(r.id),
              input_digest: sha(r.input_digest),
            };
          });
          if (new Set(selections.map((s) => s.id)).size !== selections.length)
            fail(422, "Duplicate snapshot source.");
          const snapshots = [];
          for (const s of selections) {
            const m = await this.repo.investments.market.snapshot(o, s.id);
            if (
              !m ||
              m.instrument_id !== prediction.fields.instrument_id ||
              m.dataset.input_digest !== s.input_digest
            )
              fail(404, "Exact owner/instrument snapshot unavailable.");
            if (Date.parse(m.dataset.available_at) > Date.parse(decision_at))
              fail(422, "Snapshot not known at evaluation decision.");
            snapshots.push(m);
          }
          const end = new Date(
              Date.parse(prediction.fields.baseline.date) + 45 * 86400000,
            )
              .toISOString()
              .slice(0, 10),
            calendar = referenceCalendar(
              f.instrument.market,
              prediction.fields.baseline.date,
              end,
              new Date(decision_at),
            );
          frozen = {
            prediction,
            instrument: await scope(
              this.repo,
              o,
              prediction.fields.instrument_id,
              prediction.fields.account_id,
            ),
            snapshots,
            as_of,
            decision_at,
            calendar,
            corporate_action_review: actionReview(
              b.corporate_action_review,
              decision_at,
            ),
            algorithm_version: OBSERVATION_ALGORITHM,
          };
        } else {
          const monitor = head as Observation<"monitors">,
            f = monitor.fields;
          if (!f.enabled) fail(409, "Monitor stopped.");
          const instrument = await scope(
              this.repo,
              o,
              f.instrument_id,
              f.account_id,
            ),
            as_of = shanghaiClock(new Date(now)).slice(0, 10),
            start = new Date(Date.parse(as_of) - 60 * 86400000)
              .toISOString()
              .slice(0, 10),
            calendar = referenceCalendar(
              instrument.market,
              start,
              as_of,
              new Date(now),
            );
          let snapshot = null,
            selection_reason: string | null = null;
          if (b.snapshot_id !== undefined && b.snapshot_id !== null) {
            const sid = investmentId(b.snapshot_id);
            snapshot =
              (await this.repo.investments.market.snapshot(o, sid)) ?? null;
            if (
              !snapshot ||
              snapshot.instrument_id !== f.instrument_id ||
              snapshot.dataset.supplier !== f.supplier ||
              snapshot.dataset.input_digest !== sha(b.input_digest)
            )
              fail(404, "Exact configured supplier snapshot required.");
          } else {
            if (b.input_digest !== undefined && b.input_digest !== null)
              fail(422, "Missing source must have null digest.");
            const summaries = await this.repo.investments.market.summaries(
              o,
              f.instrument_id,
            );
            if (summaries.length > 1000)
              fail(413, "Snapshot selection exceeds capacity.");
            const candidates = summaries.filter(
              (s) =>
                s.supplier === f.supplier &&
                s.start <= as_of &&
                s.end >= as_of &&
                s.created_at <= now,
            );
            if (candidates.length === 1)
              snapshot =
                (await this.repo.investments.market.snapshot(
                  o,
                  candidates[0].id,
                )) ?? null;
            else
              selection_reason = candidates.length
                ? "AMBIGUOUS_CONFIGURED_SOURCE"
                : "MISSING_CONFIGURED_SOURCE";
          }
          if (
            snapshot &&
            Date.parse(snapshot.dataset.available_at) > Date.parse(now)
          )
            fail(422, "Snapshot not yet available.");
          frozen = {
            monitor,
            instrument,
            snapshot,
            selection_reason,
            as_of,
            decision_at: now,
            calendar,
            algorithm_version: OBSERVATION_ALGORITHM,
          };
        }
        const input = { ...frozen, digest: digest(frozen) } as
          | EvaluationInput
          | CheckInput;
        if (Buffer.byteLength(JSON.stringify(input)) > OBS_LIMITS.input_bytes)
          fail(413, "Frozen work input exceeds capacity.");
        await this.context(o, kind, input);
        const w: ObservationWork = {
          sequence: works.length + 1,
          ...o,
          id,
          kind,
          resource_id: rid,
          revision: 1,
          request_key: key,
          command_keys: [key],
          input,
          status: "queued",
          attempt: 0,
          fence: null,
          lease_until: null,
          error_code: null,
          output: null,
          event_id: null,
          event_disposition: null,
          created_at: now,
          updated_at: now,
        };
        await this.store.saveWork(w, 0);
        if (kind === "check") {
          const m = head as Observation<"monitors">;
          await this.store.updateRuntime(o, rid, {
            ...m.runtime!,
            next_at: new Date(
              Date.parse(now) + m.fields.interval_seconds * 1000,
            ).toISOString(),
            last_work_id: id,
          });
        }
        return { id };
      },
    );
    await this.dispatch(o, id);
    return this.readWork(o, id);
  }
  async readWork(o: LightTickOwner, id: string) {
    investmentId(id);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const w = await this.store.work(o, id);
      if (!w) fail(404, "Observation work not found.");
      return publicObservationWork(w);
    });
  }
  async listWorks(
    o: LightTickOwner,
    cursor = "",
    limit = 20,
    resource?: string,
  ) {
    integer(limit, 1, 50);
    if (resource) investmentId(resource);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.works(o);
      if (rows.length > OBS_LIMITS.works)
        fail(413, "Work catalog exceeds capacity.");
      return page(
        rows.filter((r) => !resource || r.resource_id === resource),
        [o, "observation_work", resource ?? null],
        cursor,
        limit,
        (r) => r.id,
      );
    });
  }
  async cancel(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.command(
      o,
      key,
      "investment_observation_work",
      id,
      "cancel",
      b,
      async (now) => {
        const w = await this.store.work(o, id);
        if (!w) fail(404, "Work not found.");
        if (w.revision !== base || !["queued", "running"].includes(w.status))
          fail(409, "Work changed.");
        const n = {
          ...w,
          revision: base + 1,
          status: "cancelled" as const,
          fence: null,
          lease_until: null,
          command_keys: [...w.command_keys, key],
          updated_at: now,
        };
        await this.store.saveWork(n, base);
        return publicObservationWork(n);
      },
    );
  }
  async dispatch(o: LightTickOwner, id: string) {
    const w = await this.store.work(o, id);
    if (!w || !["queued", "running"].includes(w.status)) return;
    try {
      await this.queue.add(
        OBSERVATION_JOB,
        { app_id: o.appId, user_id: o.userId, work_id: id },
        {
          jobId: "observe-" + digest([o, id, w.attempt]).slice(0, 40),
          attempts: 1,
        },
      );
    } catch {
      /* persistent recovery */
    }
  }
}
