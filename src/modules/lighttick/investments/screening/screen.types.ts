import type { LightTickOwner } from "../../lighttick.types.ts";
import type { InvestmentInstrument } from "../investment.types.ts";
import type { MarketSnapshot } from "../market/market-work.types.ts";
export const SCREEN_ALGORITHM = "screen-rational-session-v1";
export const SCREEN_FIELDS: Record<
  string,
  { label: string; unit: string; window: number }
> = {
  close: { label: "收盘价", unit: "元", window: 1 },
  turnover_cny: { label: "当日成交额", unit: "元", window: 1 },
  turnover_rate_pct: { label: "当日换手率", unit: "%", window: 1 },
  volume_ratio_5: { label: "成交量/前5交易日均量", unit: "倍", window: 6 },
  price_above_ma20: { label: "收盘高于MA20", unit: "布尔", window: 20 },
};
for (const n of [1, 3, 5, 10, 20])
  SCREEN_FIELDS[`return_${n}d_pct`] = {
    label: `近${n}交易日价格变化`,
    unit: "%",
    window: n + 1,
  };
for (const n of [3, 5, 10, 20])
  SCREEN_FIELDS[`avg_turnover_${n}d_pct`] = {
    label: `近${n}交易日平均换手率`,
    unit: "%",
    window: n,
  };
for (const n of [5, 10, 20])
  SCREEN_FIELDS[`avg_amount_${n}d`] = {
    label: `近${n}交易日平均成交额`,
    unit: "元",
    window: n,
  };
export interface Mapping {
  source: "manual" | "explicit" | "default" | "suggested";
  quote: string;
  reason: string;
}
export interface Condition {
  field: string;
  op: "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "between";
  value: string;
  upper_value: string | null;
  mapping: Mapping;
}
export interface Recipe {
  kind: "ma_bullish" | "pullback" | "volume_breakout" | "return_window";
  window: number;
  minimum_gain: string;
  volume_ratio: string;
  shrink_ratio: string;
  pullback_min: string;
  pullback_max: string;
  near_high_ratio: string;
  exclude_st: boolean;
  exclude_suspended: boolean;
}
export interface RuleFields {
  name: string;
  description: string;
  source_text: string;
  conditions: Condition[];
  combine: "all" | "any";
  sort_by: string;
  descending: boolean;
  secondary_sort_by: string | null;
  secondary_descending: boolean;
  limit: number;
  recipe: Recipe | null;
  sort_mapping: Mapping;
}
export interface TemplateFields {
  name: string;
  description: string;
  rule: { id: string; version: number; definition_digest: string };
  instrument_ids: string[];
  account_id: string | null;
  enabled: boolean;
  tags: string[];
}
export type Definition<
  K extends "rules" | "templates" = "rules" | "templates",
> = {
  id: string;
  kind: K;
  revision: number;
  request_key: string;
  definition_digest: string;
  archived: boolean;
  created_at: string;
  updated_at: string;
  fields: K extends "rules" ? RuleFields : TemplateFields;
};
export interface SecurityStatus {
  as_of: string;
  is_st: boolean | null;
  suspended: boolean | null;
  source_label: string;
  available_at: string;
}
export interface FrozenSource {
  instrument: InvestmentInstrument;
  snapshot: MarketSnapshot | null;
  security_status: SecurityStatus | null;
}
export interface ScreenInput {
  rule: Definition<"rules">;
  template: Definition<"templates">;
  as_of: string;
  decision_at: string;
  sources: FrozenSource[];
  algorithm_version: typeof SCREEN_ALGORITHM;
  digest: string;
}
export interface ScreenDetail {
  field: string;
  label: string;
  unit: string;
  actual: string | boolean | null;
  result: boolean | null;
  reason: string | null;
  dates: string[];
  condition: Condition | null;
}
export interface Evaluation {
  instrument_id: string;
  code: string;
  market: string;
  name: string;
  status: "matched" | "excluded" | "unknown";
  values: Record<string, string | boolean | null>;
  details: ScreenDetail[];
  sorting: ScreenDetail[];
  source: Record<string, unknown>;
  limitations: string[];
}
export interface ScreenReport {
  algorithm_version: string;
  input_digest: string;
  as_of: string;
  decision_at: string;
  items: Evaluation[];
  evaluations: Evaluation[];
  total: number;
  unresolved: number;
  incomplete: boolean;
  limitations: string[];
  output_digest: string;
}
export interface ScreenWork extends LightTickOwner {
  command_keys: string[];
  id: string;
  revision: number;
  request_key: string;
  input: ScreenInput;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  output: ScreenReport | null;
  created_at: string;
  updated_at: string;
}
export type WorkSummary = Pick<
  ScreenWork,
  | "id"
  | "revision"
  | "status"
  | "attempt"
  | "error_code"
  | "created_at"
  | "updated_at"
> & { template_id: string; template_version: number };
export const workSummary = (w: ScreenWork): WorkSummary => ({
  id: w.id,
  revision: w.revision,
  status: w.status,
  attempt: w.attempt,
  error_code: w.error_code,
  created_at: w.created_at,
  updated_at: w.updated_at,
  template_id: w.input.template.id,
  template_version: w.input.template.revision,
});
export function publicWork({
  appId,
  userId,
  fence,
  lease_until,
  command_keys,
  ...w
}: ScreenWork) {
  return {
    ...w,
    input: {
      ...w.input,
      sources: w.input.sources.map((s) => ({
        ...s,
        snapshot: s.snapshot
          ? {
              ...s.snapshot,
              dataset: {
                ...s.snapshot.dataset,
                bars: undefined,
                bar_count: s.snapshot.dataset.bars.length,
              },
            }
          : null,
      })),
    },
  };
}
export interface ScreeningRepository {
  definition(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    version?: number,
  ): Promise<Definition | undefined>;
  definitions(
    o: LightTickOwner,
    kind: "rules" | "templates",
  ): Promise<Definition[]>;
  versions(
    o: LightTickOwner,
    kind: "rules" | "templates",
    id: string,
    before: number,
    limit: number,
  ): Promise<Definition[]>;
  saveDefinition(o: LightTickOwner, d: Definition, base: number): Promise<void>;
  work(o: LightTickOwner, id: string): Promise<ScreenWork | undefined>;
  works(o: LightTickOwner): Promise<WorkSummary[]>;
  saveWork(w: ScreenWork, base: number): Promise<void>;
  recoverable(now: string): Promise<ScreenWork[]>;
}
