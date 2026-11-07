import {
  object,
  keys,
  integer,
  text,
  fail,
  digest,
} from "../../learning/native-learning.validation.ts";
import { investmentId } from "../investment.service.ts";
import { numeric } from "../screening/screen.rational.ts";
import { timestamp } from "../screening/screen.validation.ts";
import { marketDate } from "../market/market.validation.ts";
import type {
  PredictionFields,
  MonitorFields,
  FeedbackFields,
  SourceRef,
  ActionReview,
  Observation,
} from "./observation.types.ts";
export function sha(v: unknown) {
  if (typeof v !== "string" || !/^[a-f0-9]{64}$/.test(v))
    fail(422, "Exact source digest required.");
  return v;
}
export function boolean(v: unknown) {
  if (typeof v !== "boolean") fail(422, "Explicit boolean required.");
  return v;
}
export function predictionFields(v: unknown): PredictionFields {
  const b = object(v);
  keys(b, [
    "instrument_id",
    "account_id",
    "direction",
    "probability",
    "reason",
    "counterevidence",
    "baseline",
    "references",
  ]);
  if (!["up", "down"].includes(String(b.direction)))
    fail(422, "Direction must be up/down.");
  const baseline = object(b.baseline);
  keys(baseline, ["snapshot_id", "input_digest", "date"]);
  if (!Array.isArray(b.references) || b.references.length > 20)
    fail(422, "At most 20 exact references.");
  const references = b.references.map((v) => {
    const r = object(v);
    keys(r, ["kind", "id", "version", "digest"]);
    if (
      !["research", "material", "screen_rule", "screen_run"].includes(
        String(r.kind),
      )
    )
      fail(422, "Unknown source kind.");
    return {
      kind: r.kind,
      id: investmentId(r.id),
      version: integer(r.version, 1, 100),
      digest: sha(r.digest),
    } as SourceRef;
  });
  if (
    new Set(references.map((r) => r.kind + ":" + r.id)).size !==
    references.length
  )
    fail(422, "Duplicate source.");
  return {
    instrument_id: investmentId(b.instrument_id),
    account_id: b.account_id === null ? null : investmentId(b.account_id),
    direction: b.direction as "up" | "down",
    probability: b.probability === null ? null : integer(b.probability, 0, 100),
    reason: text(b.reason, 4000, true),
    counterevidence: text(b.counterevidence, 4000, true),
    baseline: {
      snapshot_id: investmentId(baseline.snapshot_id),
      input_digest: sha(baseline.input_digest),
      date: marketDate(baseline.date),
    },
    references,
  };
}
export function feedbackFields(v: unknown): FeedbackFields {
  const b = object(v);
  keys(b, [
    "prediction_id",
    "evaluation_id",
    "horizon",
    "reflection",
    "learned",
    "next_step",
  ]);
  if (![1, 3, 5, 10].includes(Number(b.horizon)))
    fail(422, "Choose a frozen horizon.");
  return {
    prediction_id: investmentId(b.prediction_id),
    evaluation_id: investmentId(b.evaluation_id),
    horizon: integer(b.horizon, 1, 10) as 1 | 3 | 5 | 10,
    reflection: text(b.reflection, 4000, true),
    learned: text(b.learned, 4000),
    next_step: text(b.next_step, 2000),
  };
}
export function monitorFields(v: unknown): MonitorFields {
  const b = object(v);
  keys(b, [
    "instrument_id",
    "account_id",
    "name",
    "field",
    "op",
    "threshold",
    "supplier",
    "enabled",
    "interval_seconds",
    "cooldown_seconds",
  ]);
  if (
    ![
      "close",
      "return_1d_pct",
      "volume_ratio_5",
      "price_above_ma20",
      "ma_bullish",
    ].includes(String(b.field)) ||
    !["gt", "gte", "lt", "lte"].includes(String(b.op)) ||
    !["csv", "tushare", "eastmoney", "tencent"].includes(String(b.supplier))
  )
    fail(422, "Unsupported daily monitor field/operator/source.");
  const threshold = numeric(b.threshold);
  if (
    ["price_above_ma20", "ma_bullish"].includes(String(b.field)) &&
    (threshold !== "1" || b.op !== "gte")
  )
    fail(422, "Boolean daily condition uses gte 1.");
  return {
    instrument_id: investmentId(b.instrument_id),
    account_id: b.account_id === null ? null : investmentId(b.account_id),
    name: text(b.name, 100, true),
    field: b.field as MonitorFields["field"],
    op: b.op as MonitorFields["op"],
    threshold,
    supplier: b.supplier as MonitorFields["supplier"],
    enabled: boolean(b.enabled),
    interval_seconds: integer(b.interval_seconds, 300, 86400),
    cooldown_seconds: integer(b.cooldown_seconds, 60, 604800),
  };
}
export function actionReview(
  v: unknown,
  decision: string,
): ActionReview | null {
  if (v === null) return null;
  const b = object(v);
  keys(b, ["unchanged", "source_label", "available_at"]);
  const available_at = timestamp(b.available_at);
  if (Date.parse(available_at) > Date.parse(decision))
    fail(422, "Review not known at decision time.");
  return {
    unchanged: boolean(b.unchanged),
    source_label: text(b.source_label, 500, true),
    available_at,
  };
}
export function rowDigest(
  row: Pick<Observation, "kind" | "fields" | "frozen" | "archived">,
) {
  return digest({
    kind: row.kind,
    fields: row.fields,
    frozen: row.frozen ?? null,
    archived: row.archived,
  });
}
