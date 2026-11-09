import type { LightTickOwner } from "../../lighttick.types.ts";
import type { InvestmentInstrument } from "../investment.types.ts";
import type { MarketSnapshot } from "../market/market-work.types.ts";
import type { MarketCalendar } from "../market/market.calendar.ts";
export const OBSERVATION_ALGORITHM = "forecast-daily-rational-v1";
export type ObservationKind =
  | "predictions"
  | "feedback"
  | "monitors"
  | "events";
export type SourceRef = {
  kind: "research" | "material" | "screen_rule" | "screen_run";
  id: string;
  version: number;
  digest: string;
};
export interface PredictionFields {
  instrument_id: string;
  account_id: string | null;
  direction: "up" | "down";
  probability: number | null;
  reason: string;
  counterevidence: string;
  baseline: { snapshot_id: string; input_digest: string; date: string };
  references: SourceRef[];
}
export interface PredictionFrozen {
  baseline_price: string;
  instrument: InvestmentInstrument;
  snapshot: MarketSnapshot;
  references: { ref: SourceRef; content: unknown }[];
  registered_at: string;
  calendar: MarketCalendar;
  digest: string;
}
export interface FeedbackFields {
  prediction_id: string;
  evaluation_id: string;
  horizon: 1 | 3 | 5 | 10;
  reflection: string;
  learned: string;
  next_step: string;
}
export interface MonitorFields {
  instrument_id: string;
  account_id: string | null;
  name: string;
  field:
    | "close"
    | "return_1d_pct"
    | "volume_ratio_5"
    | "price_above_ma20"
    | "ma_bullish";
  op: "gt" | "gte" | "lt" | "lte";
  threshold: string;
  supplier: "csv" | "tushare" | "eastmoney" | "tencent";
  enabled: boolean;
  interval_seconds: number;
  cooldown_seconds: number;
}
export interface MonitorRuntime {
  next_at: string;
  last_source: string | null;
  last_triggered_at: string | null;
  last_work_id: string | null;
  last_error?: string | null;
}
export interface EventFields {
  monitor_id: string;
  monitor_version: number;
  work_id: string;
  observation: unknown;
  deduplication_key: string;
  read: boolean;
}
export interface Observation<K extends ObservationKind = ObservationKind> {
  kind: K;
  id: string;
  revision: number;
  request_key: string;
  digest: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  fields: K extends "predictions"
    ? PredictionFields
    : K extends "feedback"
      ? FeedbackFields
      : K extends "monitors"
        ? MonitorFields
        : EventFields;
  frozen?: PredictionFrozen | Record<string, unknown>;
  runtime?: MonitorRuntime;
}
export interface ActionReview {
  unchanged: boolean;
  source_label: string;
  available_at: string;
}
export interface EvaluationInput {
  instrument: InvestmentInstrument;
  prediction: Observation<"predictions">;
  snapshots: MarketSnapshot[];
  as_of: string;
  decision_at: string;
  calendar: MarketCalendar;
  corporate_action_review: ActionReview | null;
  algorithm_version: typeof OBSERVATION_ALGORITHM;
  digest: string;
}
export interface CheckInput {
  monitor: Observation<"monitors">;
  instrument: InvestmentInstrument;
  snapshot: MarketSnapshot | null;
  selection_reason: string | null;
  as_of: string;
  decision_at: string;
  calendar: MarketCalendar;
  algorithm_version: typeof OBSERVATION_ALGORITHM;
  digest: string;
}
export interface Outcome {
  horizon: number;
  state: "pending" | "unknown" | "resolved";
  target_date: string | null;
  price: string | null;
  raw_return_pct: string | null;
  correct: boolean | null;
  reason: string | null;
  source_ids: string[];
  dates: string[];
}
export interface EvaluationReport {
  kind: "evaluation";
  outcomes: Outcome[];
  input_digest: string;
  output_digest: string;
  limitations: string[];
}
export interface CheckReport {
  kind: "check";
  state: "triggered" | "not_met" | "unknown" | "closed" | "waiting_for_close";
  actual: string | boolean | null;
  reason: string | null;
  dates: string[];
  source_time: string | null;
  input_digest: string;
  output_digest: string;
  limitations: string[];
  source: Record<string, unknown>;
}
export interface ObservationWork extends LightTickOwner {
  sequence: number;
  id: string;
  kind: "evaluation" | "check";
  revision: number;
  resource_id: string;
  request_key: string;
  command_keys: string[];
  input: EvaluationInput | CheckInput;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  output: EvaluationReport | CheckReport | null;
  event_id: string | null;
  event_disposition: string | null;
  created_at: string;
  updated_at: string;
}
export type WorkSummary = Pick<
  ObservationWork,
  | "id"
  | "sequence"
  | "kind"
  | "revision"
  | "resource_id"
  | "status"
  | "attempt"
  | "error_code"
  | "created_at"
  | "updated_at"
>;
export interface ObservationStore {
  get(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    version?: number,
  ): Promise<Observation | undefined>;
  list(o: LightTickOwner, kind: ObservationKind): Promise<Observation[]>;
  versions(
    o: LightTickOwner,
    kind: ObservationKind,
    id: string,
    before: number,
    limit: number,
    viewOnly?: boolean,
  ): Promise<Observation[]>;
  save(o: LightTickOwner, row: Observation, base: number): Promise<void>;
  updateRuntime(
    o: LightTickOwner,
    id: string,
    runtime: MonitorRuntime,
  ): Promise<void>;
  work(o: LightTickOwner, id: string): Promise<ObservationWork | undefined>;
  works(o: LightTickOwner): Promise<WorkSummary[]>;
  saveWork(row: ObservationWork, base: number): Promise<void>;
  recoverable(now: string): Promise<ObservationWork[]>;
  calibrationRows(o: LightTickOwner): Promise<
    {
      prediction_id: string;
      probability: number | null;
      as_of: string;
      decision_at: string;
      sequence: number;
      outcomes: Outcome[];
    }[]
  >;
  due(now: string): Promise<(LightTickOwner & { id: string })[]>;
}
export function publicObservation<T extends Observation>(row: T): T {
  const copy = structuredClone(row);
  const frozen = copy.frozen as PredictionFrozen | undefined;
  for (const reference of frozen?.references ?? []) {
    if (reference.ref.kind === "screen_run") {
      for (const source of (reference.content as any)?.input?.sources ?? []) {
        const data = source.snapshot?.dataset;
        if (data?.bars) {
          data.bar_count = data.bars.length;
          delete data.bars;
        }
      }
    }
  }
  if (frozen?.snapshot) {
    const d = frozen.snapshot.dataset as any;
    d.bar_count = d.bars.length;
    delete d.bars;
  }
  return copy;
}
export function publicObservationWork(w: ObservationWork) {
  const { appId, userId, fence, lease_until, command_keys, ...copy } =
    structuredClone(w);
  if (copy.kind === "evaluation") {
    const i = copy.input as EvaluationInput;
    i.prediction = publicObservation(i.prediction);
    i.snapshots = i.snapshots.map((s) => {
      const d = s.dataset as any;
      d.bar_count = d.bars.length;
      delete d.bars;
      return s;
    });
  } else {
    const i = copy.input as CheckInput;
    if (i.snapshot) {
      const d = i.snapshot.dataset as any;
      d.bar_count = d.bars.length;
      delete d.bars;
    }
  }
  return copy;
}
