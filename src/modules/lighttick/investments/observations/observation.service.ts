import { InvestmentService, investmentId } from "../investment.service.ts";
import {
  keys,
  object,
  integer,
  digest,
  fail,
} from "../../learning/native-learning.validation.ts";
import { page } from "../screening/screen.definitions.ts";
import { referenceCalendar } from "../market/market.calendar.ts";
import { marketDate, shanghaiClock } from "../market/market.validation.ts";
import { completed } from "./observation.engine.ts";
import {
  predictionFields,
  feedbackFields,
  monitorFields,
  rowDigest,
} from "./observation.validation.ts";
import {
  scope,
  resolveReferences,
  recheckReferences,
} from "./observation.sources.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type {
  Observation,
  ObservationKind,
  PredictionFrozen,
  PredictionFields,
  FeedbackFields,
  MonitorFields,
  EvaluationReport,
} from "./observation.types.ts";
import {
  publicObservation,
  publicObservationWork,
} from "./observation.types.ts";
export const OBS_LIMITS = {
  predictions: 200,
  feedback: 500,
  monitors: 50,
  events: 1000,
  works: 300,
  daily: 40,
  active: 2,
  input_bytes: 2 * 1024 * 1024,
  attempts: 3,
  lease_ms: 60000,
  timeout_ms: 30000,
};
export class ObservationService extends InvestmentService {
  get store() {
    return this.repo.investments.observations;
  }
  async readObservation(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    version?: number,
  ) {
    investmentId(id);
    if (version !== undefined) integer(version, 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const row = await this.store.get(o, kind, id, version);
      if (!row) fail(404, "Observation not found.");
      return publicObservation(row);
    });
  }
  async listObservations(
    o: LightTickOwner,
    kind: ObservationKind,
    cursor = "",
    limit = 20,
    includeArchived = false,
    resource?: string,
    unread = false,
  ) {
    integer(limit, 1, 50);
    if (resource) investmentId(resource);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const all = await this.store.list(o, kind);
      if (all.length > OBS_LIMITS[kind])
        fail(413, "Observation catalog exceeds capacity.");
      return page(
        all
          .filter(
            (r) =>
              (includeArchived || !r.archived) &&
              (!resource ||
                r.id === resource ||
                (r.fields as any).prediction_id === resource ||
                (r.fields as any).monitor_id === resource) &&
              (!unread || !(r.fields as any).read),
          )
          .map(publicObservation),
        [o, kind, includeArchived, resource ?? null, unread],
        cursor,
        limit,
        (r) => r.id,
      );
    });
  }
  async history(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    cursor = "",
    limit = 10,
  ) {
    investmentId(id);
    integer(limit, 1, 20);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const head = await this.store.get(o, kind, id);
      if (!head) fail(404, "Observation not found.");
      const scope = digest([o, kind, id, head.revision]);
      let before = head.revision + 1;
      if (cursor) {
        try {
          const c = JSON.parse(Buffer.from(cursor, "base64url").toString());
          if (
            cursor.length > 2048 ||
            c.scope !== scope ||
            !Number.isInteger(c.before) ||
            c.before < 1 ||
            c.before > before
          )
            throw Error();
          before = c.before;
        } catch {
          fail(409, "History changed; retain drafts and rebuild reads.");
        }
      }
      const rows = await this.store.versions(
          o,
          kind,
          id,
          before,
          limit + 1,
          true,
        ),
        items = rows.slice(0, limit).map(publicObservation);
      return {
        items,
        revision: head.revision,
        next_cursor:
          rows.length > limit
            ? Buffer.from(
                JSON.stringify({ scope, before: items.at(-1)!.revision }),
              ).toString("base64url")
            : null,
      };
    });
  }
  async write(
    o: LightTickOwner,
    kind: Exclude<ObservationKind, "events">,
    id: string,
    b: Record<string, unknown>,
    key: string,
  ) {
    investmentId(id);
    keys(b, ["base_revision", "fields", "consent"]);
    const base = integer(b.base_revision, 0, 99),
      fields =
        kind === "predictions"
          ? predictionFields(b.fields)
          : kind === "feedback"
            ? feedbackFields(b.fields)
            : monitorFields(b.fields);
    if (b.consent !== true) fail(422, "Explicit reviewed submission required.");
    return this.command(
      o,
      key,
      "investment_observation_" + kind,
      id,
      "save",
      b,
      async (now) => {
        const old = await this.store.get(o, kind, id);
        if ((old?.revision ?? 0) !== base || old?.archived)
          fail(409, "Observation version/archive changed; retain all copies.");
        if (!old && (await this.store.list(o, kind)).length >= OBS_LIMITS[kind])
          fail(413, "Observation capacity exhausted.");
        let frozen: any = old?.frozen,
          runtime = old?.runtime;
        if (kind === "predictions") {
          if (old)
            fail(
              409,
              "Prediction registration is immutable; add a feedback record.",
            );
          const f = fields as PredictionFields,
            instrument = await scope(
              this.repo,
              o,
              f.instrument_id,
              f.account_id,
            ),
            snapshot = await this.repo.investments.market.snapshot(
              o,
              f.baseline.snapshot_id,
            );
          const on = shanghaiClock(new Date(now)).slice(0, 10),
            start = new Date(Date.parse(on) - 14 * 86400000)
              .toISOString()
              .slice(0, 10),
            cal = referenceCalendar(
              instrument.market,
              start,
              on,
              new Date(now),
            );
          const expected = Object.entries(cal.sessions)
            .filter(([d, open]) => open && completed(d, now))
            .map(([d]) => d)
            .sort()
            .at(-1);
          if (
            cal.status !== "available" ||
            expected !== f.baseline.date ||
            !snapshot ||
            snapshot.instrument_id !== instrument.id ||
            snapshot.dataset.input_digest !== f.baseline.input_digest ||
            snapshot.dataset.price_basis !== "unadjusted" ||
            Date.parse(snapshot.dataset.available_at) > Date.parse(now) ||
            !snapshot.dataset.bars.some((bar) => bar.date === expected)
          )
            fail(
              422,
              "Exact latest completed baseline known at registration required.",
            );
          frozen = {
            instrument,
            snapshot,
            baseline_price: snapshot.dataset.bars.find(
              (bar) => bar.date === f.baseline.date,
            )!.close,
            references: await resolveReferences(this.repo, o, f),
            registered_at: now,
            calendar: cal,
          };
          frozen.digest = digest(frozen);
        } else if (kind === "feedback") {
          const f = fields as FeedbackFields,
            p = await this.store.get(o, "predictions", f.prediction_id),
            w = await this.store.work(o, f.evaluation_id);
          if (
            !p ||
            p.archived ||
            !w ||
            w.kind !== "evaluation" ||
            w.resource_id !== p.id ||
            w.status !== "succeeded"
          )
            fail(404, "Owner prediction and confirmed evaluation required.");
          if (
            old &&
            (old.fields as FeedbackFields).prediction_id !== f.prediction_id
          )
            fail(409, "Feedback prediction identity is immutable.");
          await scope(
            this.repo,
            o,
            (p.fields as PredictionFields).instrument_id,
            (p.fields as PredictionFields).account_id,
          );
          const outcome = (w.output as EvaluationReport).outcomes.find(
            (r) => r.horizon === f.horizon,
          );
          if (!outcome) fail(422, "Choose an evaluated horizon.");
          frozen = {
            prediction_id: p.id,
            prediction_digest: p.digest,
            evaluation_id: w.id,
            evaluation_output_digest: w.output!.output_digest,
            outcome,
          };
        } else {
          const f = fields as MonitorFields;
          await scope(this.repo, o, f.instrument_id, f.account_id);
          if (
            old &&
            ((old.fields as MonitorFields).instrument_id !== f.instrument_id ||
              (old.fields as MonitorFields).account_id !== f.account_id)
          )
            fail(409, "Monitor identity/account is immutable.");
          runtime = runtime ?? {
            next_at: now,
            last_source: null,
            last_triggered_at: null,
            last_work_id: null,
          };
          runtime = { ...runtime, next_at: now };
        }
        if (
          Buffer.byteLength(JSON.stringify({ fields, frozen })) >
          OBS_LIMITS.input_bytes
        )
          fail(413, "Frozen observation exceeds capacity.");
        const row: Observation = {
          id,
          kind,
          revision: base + 1,
          request_key: key,
          fields,
          archived: false,
          ...(frozen ? { frozen } : {}),
          ...(runtime ? { runtime } : {}),
          created_at: old?.created_at ?? now,
          updated_at: now,
          digest: "",
        };
        row.digest = rowDigest(row);
        await this.store.save(o, row, base);
        return publicObservation(row);
      },
    );
  }
  async transition(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    b: Record<string, unknown>,
    key: string,
    action: "archive" | "restore" | "stop" | "read",
  ) {
    investmentId(id);
    keys(b, ["base_revision"]);
    const base = integer(b.base_revision, 1, 99);
    if (
      (action === "read" && kind !== "events") ||
      (action === "stop" && kind !== "monitors") ||
      (["archive", "restore"].includes(action) && kind === "events")
    )
      fail(422, "Unsupported transition.");
    return this.command(
      o,
      key,
      "investment_observation_" + kind,
      id,
      action,
      b,
      async (now) => {
        const old = await this.store.get(o, kind, id);
        if (!old) fail(404, "Observation not found.");
        if (old.revision !== base) fail(409, "Observation version changed.");
        if (
          (action === "read" && (old.fields as any).read) ||
          (action === "stop" && !(old.fields as any).enabled) ||
          (action === "archive" && old.archived) ||
          (action === "restore" && !old.archived)
        )
          fail(409, "State already changed.");
        const row = {
          ...old,
          fields: {
            ...old.fields,
            ...(action === "read"
              ? { read: true }
              : action === "stop"
                ? { enabled: false }
                : {}),
          },
          archived:
            action === "archive"
              ? true
              : action === "restore"
                ? false
                : old.archived,
          revision: base + 1,
          request_key: key,
          updated_at: now,
        };
        row.digest = rowDigest(row);
        await this.store.save(o, row, base);
        return publicObservation(row);
      },
    );
  }
  async context(o: LightTickOwner, kind: "evaluation" | "check", input: any) {
    if (kind === "evaluation") {
      const p = await this.store.get(o, "predictions", input.prediction.id);
      if (
        !p ||
        p.archived ||
        p.revision !== input.prediction.revision ||
        p.digest !== input.prediction.digest
      )
        fail(409, "Prediction archived or changed.");
      const instrument = await scope(
        this.repo,
        o,
        (p.fields as PredictionFields).instrument_id,
        (p.fields as PredictionFields).account_id,
      );
      if (instrument.revision !== input.instrument.revision)
        fail(409, "Prediction instrument changed.");
      await recheckReferences(this.repo, o, input.prediction.fields.references);
    } else {
      const m = await this.store.get(o, "monitors", input.monitor.id);
      if (
        !m ||
        m.archived ||
        m.revision !== input.monitor.revision ||
        !(m.fields as MonitorFields).enabled
      )
        fail(409, "Monitor stopped or configuration changed.");
      const i = await scope(
        this.repo,
        o,
        (m.fields as MonitorFields).instrument_id,
        (m.fields as MonitorFields).account_id,
      );
      if (i.revision !== input.instrument.revision)
        fail(409, "Monitor instrument changed.");
    }
  }
  async sourcePreview(
    o: LightTickOwner,
    q: Record<string, string | undefined>,
  ) {
    const kind = q.kind as import("./observation.types.ts").SourceRef["kind"];
    if (!["research", "material", "screen_rule", "screen_run"].includes(kind))
      fail(422, "Unknown source kind.");
    const instrument_id = investmentId(q.instrument_id),
      account_id = q.account_id ? investmentId(q.account_id) : null,
      id = investmentId(q.id),
      version = integer(Number(q.version), 1, 100);
    return this.repo.transaction(o, async () => {
      await this.authorize();
      await scope(this.repo, o, instrument_id, account_id);
      const [result] = await resolveReferences(
        this.repo,
        o,
        {
          instrument_id,
          account_id,
          references: [{ kind, id, version, digest: "0".repeat(64) }],
        } as PredictionFields,
        true,
      );
      const c = result.content as any;
      const full =
        kind === "screen_run"
          ? String(c.input.rule.fields.name) +
            "\n" +
            JSON.stringify(
              c.output.items.map((r: any) => ({
                name: r.name,
                status: r.status,
                values: r.values,
              })),
            )
          : [
              c.title ?? c.fields?.name ?? "",
              c.content ?? c.fields?.source_text ?? "",
              c.market_context ?? "",
              c.contrary_case ?? "",
              c.contrary_evidence ?? "",
            ].join("\n");
      return {
        ref: result.ref,
        title: c.title ?? c.fields?.name ?? id,
        excerpt: full.slice(0, 4000),
        truncated: full.length > 4000,
      };
    });
  }
  async calibration(o: LightTickOwner) {
    return this.repo.transaction(o, async () => {
      await this.authorize();
      const rows = await this.store.calibrationRows(o),
        latest = new Map<string, any>();
      if (rows.length > OBS_LIMITS.works)
        fail(413, "Calibration exceeds bounded capacity.");
      for (const r of rows.sort(
        (a, b) =>
          a.as_of.localeCompare(b.as_of) ||
          a.decision_at.localeCompare(b.decision_at) ||
          a.sequence - b.sequence,
      ))
        for (const outcome of r.outcomes)
          latest.set(r.prediction_id + ":" + outcome.horizon, {
            probability: r.probability,
            outcome,
          });
      const { from, sub, mul, div, display, sum } =
        await import("../screening/screen.rational.ts");
      let resolved = 0,
        correct = 0,
        unresolved = 0;
      const scores = [];
      for (const { probability, outcome } of latest.values()) {
        if (outcome.state !== "resolved") {
          unresolved++;
          continue;
        }
        resolved++;
        if (outcome.correct) correct++;
        if (probability !== null) {
          const delta = sub(
            div(from(String(probability)), from("100")),
            from(outcome.correct ? "1" : "0"),
          );
          scores.push(mul(delta, delta));
        }
      }
      return {
        resolved,
        unresolved,
        correct,
        accuracy: resolved
          ? display(div(from(String(correct)), from(String(resolved))))
          : null,
        probability_samples: scores.length,
        brier_score: scores.length
          ? display(div(sum(scores), from(String(scores.length))))
          : null,
        scope:
          "每个预测×1/3/5/10后续交易日，按截止日、决策时点及owner登记序号取最近成功核对；本人声明公司行动，非实盘胜率。",
        read_only: true,
      };
    });
  }
}
