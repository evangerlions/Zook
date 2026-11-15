import type { LightTickOwner } from "../lighttick.types.ts";
import type { ModelSelection } from "../personal-model/personal-model.types.ts";
export interface AccountReportFacts {
  behavior?: {
    applications: {
      total: number;
      rated_count: number;
      effectiveness_avg: number | null;
      top_concepts: { concept: string; count: number }[];
    };
    errors: { total: number; repeated: number; repeat_rate: number | null };
    predictions: {
      total: number;
      resolved: number;
      correct: number;
      pending: number;
      excluded: number;
      accuracy: number | null;
      brier_score: number | null;
    };
  };
  version: "account-facts-v1";
  start: string;
  end: string;
  period_days: number;
  timezone: string;
  snapshot_at: string;
  active_days: number;
  unknown_date_count: number;
  metrics: {
    key: string;
    label: string;
    count: number;
    date_basis: string;
    coverage: "included" | "partial" | "not_authorized";
  }[];
  modules: { id: string; name: string; recorded_days: number }[];
  durations: {
    key: string;
    label: string;
    minutes: number;
    recorded_days: number;
  }[];
  limitations: string[];
  digest: string;
}
export interface AccountReportOutput {
  overview: string;
  observations: { text: string; evidence_keys: string[] }[];
  suggestions: string[];
  limitations: string;
  provider: string;
  model: string;
  prompt_version: string;
}
export interface AccountReportRow extends LightTickOwner {
  topic?: "account" | "behavior";
  id: string;
  revision: number;
  request_hash: string;
  period_days: number;
  mode: "facts" | "ai";
  retry_of: string | null;
  status:
    | "queued"
    | "running"
    | "ready"
    | "failed"
    | "cancelled"
    | "interrupted"
    | "deleted";
  facts: AccountReportFacts | null;
  output: AccountReportOutput | null;
  model_selection: ModelSelection | null;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}
export interface AccountReportRepository {
  get(owner: LightTickOwner, id: string): Promise<AccountReportRow | undefined>;
  save(row: AccountReportRow, base: number): Promise<void>;
  list(
    owner: LightTickOwner,
    offset: number,
    limit: number,
    topic?: "account" | "behavior",
  ): Promise<{ items: AccountReportSummary[]; total: number }>;
  recoverable(now: string): Promise<AccountReportRow[]>;
  deleteOwner?(owner: LightTickOwner): void;
}
export const ACCOUNT_REPORT_JOB = "lighttick.account-report";
export const ACCOUNT_REPORT_SCENE = {
  key: "lighttick.account-report.v1",
  model_alias: "novel-structured",
  prompt_version: "account-report-v1",
  max_input_bytes: 32000,
  max_output_tokens: 2500,
  timeout_ms: 30000,
} as const;
export function publicReport({
  appId,
  userId,
  request_hash,
  model_selection,
  fence,
  lease_until,
  ...row
}: AccountReportRow) {
  return row;
}
export function reportSummary(row: AccountReportRow) {
  const { facts, output, ...rest } = publicReport(row);
  return {
    ...rest,
    period_start: facts?.start ?? null,
    period_end: facts?.end ?? null,
    timezone: facts?.timezone ?? null,
    active_days: facts?.active_days ?? null,
  };
}

export type AccountReportSummary = ReturnType<typeof reportSummary>;
