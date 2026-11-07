import { setImmediate } from "node:timers/promises";
import { digest } from "../../learning/native-learning.validation.ts";
import { shanghaiClock } from "../market/market.validation.ts";
import {
  from,
  sub,
  mul,
  div,
  compare,
  mean,
  display,
} from "../screening/screen.rational.ts";
import type {
  EvaluationInput,
  EvaluationReport,
  Outcome,
  CheckInput,
  CheckReport,
  PredictionFrozen,
} from "./observation.types.ts";
import { screen } from "../screening/screen.engine.ts";
import { SCREEN_ALGORITHM } from "../screening/screen.types.ts";
export const observationLimitations = [
  "仅核对冻结日线与明确来源；未复权价格变化不代表实盘收益。",
  "公司行动声明为本人核对，未独立验证；未知不计入校准。",
  "精确有理数比较，展示最多28位小数；不自动创建交易或行动。",
];
export function completed(day: string, decision: string) {
  const t = shanghaiClock(new Date(decision));
  return (
    day < t.slice(0, 10) ||
    (day === t.slice(0, 10) && t.slice(11, 16) >= "15:30")
  );
}
export async function evaluatePrediction(
  input: EvaluationInput,
  signal?: AbortSignal,
): Promise<EvaluationReport> {
  const { prediction: p, calendar: c } = input,
    f = p.frozen as PredictionFrozen,
    reg = f.registered_at,
    baseDate = p.fields.baseline.date;
  const sessions = Object.entries(c.sessions)
    .filter(
      ([d, open]) =>
        open && Date.parse(d + "T09:30:00+08:00") > Date.parse(reg),
    )
    .map(([d]) => d)
    .sort();
  const outcomes: Outcome[] = [];
  for (const n of [1, 3, 5, 10]) {
    signal?.throwIfAborted();
    const target = sessions[n - 1] ?? null;
    const result: Outcome = {
      horizon: n,
      state: "pending",
      target_date: target,
      price: null,
      raw_return_pct: null,
      correct: null,
      reason: null,
      source_ids: [],
      dates: [],
    };
    const decisions = shanghaiClock(new Date(input.decision_at)).slice(0, 10);
    if (c.status !== "available" || c.review_until < decisions) {
      result.state = "unknown";
      result.reason = "CALENDAR_UNAVAILABLE";
    } else if (
      !target ||
      target > input.as_of ||
      !completed(target, input.decision_at)
    ) {
      result.reason = "FUTURE_SESSION_PENDING";
    } else {
      result.dates = Object.entries(c.sessions)
        .filter(([d, open]) => open && d > baseDate && d <= target)
        .map(([d]) => d)
        .sort();
      const sources = [f.snapshot, ...input.snapshots].filter(
        (s) =>
          s.dataset.price_basis === "unadjusted" &&
          Date.parse(s.dataset.available_at) <= Date.parse(input.decision_at),
      );
      const matches = sources.flatMap((s) =>
          s.dataset.bars
            .filter((b) => b.date === target)
            .map((bar) => ({ s, bar })),
        ),
        prices = new Set(
          matches.map((m) => {
            const p = from(m.bar.close);
            return p.n + "/" + p.d;
          }),
        );
      result.source_ids = [...new Set(matches.map((m) => m.s.id))];
      if (prices.size !== 1) {
        result.state = "unknown";
        result.reason = prices.size
          ? "CONFLICTING_TARGET_QUOTES"
          : "MISSING_TARGET_QUOTE";
      } else {
        result.price = matches[0].bar.close;
        const baseline = f.snapshot.dataset.bars.find(
          (b) => b.date === baseDate,
        )!.close;
        result.raw_return_pct = display(
          mul(
            sub(div(from(result.price), from(baseline)), from("1")),
            from("100"),
          ),
        );
        const missing = result.dates.some(
          (d) => !sources.some((s) => s.dataset.bars.some((b) => b.date === d)),
        );
        const conflict = result.dates.some(
          (d) =>
            new Set(
              sources.flatMap((s) =>
                s.dataset.bars
                  .filter((b) => b.date === d)
                  .map((b) => {
                    const p = from(b.close);
                    return p.n + "/" + p.d;
                  }),
              ),
            ).size > 1,
        );
        if (
          missing ||
          conflict ||
          input.corporate_action_review?.unchanged !== true
        ) {
          result.state = "unknown";
          result.reason = missing
            ? "MISSING_INTERVAL_QUOTE"
            : conflict
              ? "CONFLICTING_INTERVAL_QUOTES"
              : "CORPORATE_ACTIONS_UNREVIEWED";
        } else {
          result.state = "resolved";
          const cmp = compare(from(result.price), from(baseline));
          result.correct = p.fields.direction === "up" ? cmp > 0 : cmp < 0;
        }
      }
    }
    outcomes.push(result);
    await setImmediate();
  }
  const report = {
    kind: "evaluation" as const,
    outcomes,
    input_digest: input.digest,
    limitations: observationLimitations,
  };
  return { ...report, output_digest: digest(report) };
}
export async function checkMonitor(
  input: CheckInput,
  signal?: AbortSignal,
): Promise<CheckReport> {
  const { monitor: m, calendar: c, snapshot: s, as_of, decision_at } = input,
    f = m.fields;
  let state: CheckReport["state"] = "unknown",
    reason = input.selection_reason,
    actual: CheckReport["actual"] = null,
    dates: string[] = [];
  const local = shanghaiClock(new Date(decision_at));
  if (c.status !== "available" || c.review_until < local.slice(0, 10))
    reason = "CALENDAR_UNAVAILABLE";
  else if (c.sessions[as_of] !== true) {
    state = "closed";
    reason = "NOT_TRADING_SESSION";
  } else if (!completed(as_of, decision_at)) {
    state = "waiting_for_close";
    reason = "SESSION_INCOMPLETE";
  } else if (!s) reason = reason ?? "MISSING_SNAPSHOT";
  else if (s.dataset.price_basis !== "unadjusted")
    reason = "PRICE_BASIS_UNKNOWN";
  else if (f.field === "ma_bullish") {
    dates = Object.entries(c.sessions)
      .filter(([d, open]) => open && d <= as_of)
      .map(([d]) => d)
      .sort()
      .slice(-20);
    const bars = dates.map((d) => s.dataset.bars.find((b) => b.date === d));
    if (bars.length !== 20 || bars.some((b) => !b)) reason = "WINDOW_MISSING";
    else {
      const closes = bars.map((b) => from(b!.close));
      actual =
        compare(mean(closes.slice(-5)), mean(closes.slice(-10))) > 0 &&
        compare(mean(closes.slice(-10)), mean(closes)) > 0;
      reason = null;
      state = actual ? "triggered" : "not_met";
    }
  } else {
    const mapping = { source: "manual" as const, quote: "", reason: "" },
      rule: any = {
        id: m.id,
        kind: "rules",
        revision: m.revision,
        fields: {
          conditions: [
            {
              field: f.field,
              op: f.field === "price_above_ma20" ? "eq" : f.op,
              value: f.field === "price_above_ma20" ? "true" : f.threshold,
              upper_value: null,
              mapping,
            },
          ],
          combine: "all",
          sort_by: f.field,
          descending: true,
          secondary_sort_by: null,
          secondary_descending: true,
          limit: 1,
          recipe: null,
        },
      };
    const report = await screen(
        {
          rule,
          template: {} as any,
          as_of,
          decision_at,
          sources: [
            {
              instrument: input.instrument,
              snapshot: s,
              security_status: null,
            },
          ],
          algorithm_version: SCREEN_ALGORITHM,
          digest: input.digest,
        },
        signal,
      ),
      d = report.evaluations[0].details[0];
    actual = d.actual;
    reason = d.reason;
    dates = d.dates;
    state = d.result === null ? "unknown" : d.result ? "triggered" : "not_met";
  }
  const report = {
    kind: "check" as const,
    state,
    actual,
    reason,
    dates,
    source_time: s?.dataset.bars.some((b) => b.date === as_of) ? as_of : null,
    input_digest: input.digest,
    limitations: observationLimitations,
    source: {
      snapshot_id: s?.id ?? null,
      input_digest: s?.dataset.input_digest ?? null,
      supplier: s?.dataset.supplier ?? f.supplier,
      adapter_version: s?.dataset.adapter_version ?? null,
      available_at: s?.dataset.available_at ?? null,
      calendar: c,
      price_basis: s?.dataset.price_basis ?? null,
    },
  };
  return { ...report, output_digest: digest(report) };
}
