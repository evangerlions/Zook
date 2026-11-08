import type { LightTickOwner } from "../lighttick.types.ts";
import type { Fill, CashEvent, reconcile } from "./accounting.ts";
export type LedgerFact = { business_date: string } & (
  | { kind: "fill"; fill: Fill }
  | { kind: "cash"; cash: CashEvent }
);
export interface LedgerCorrection {
  target_event_id: string;
  target_input_digest: string;
  reason: string;
  replacement: LedgerFact | null;
}
export type LedgerInput = LedgerFact | {kind: "correction"; business_date: string; correction: LedgerCorrection};
export interface LedgerEvent {
  id: string;
  account_id: string;
  sequence: number;
  input: LedgerInput;
  created_at: string;
}
export interface LedgerWork extends LightTickOwner {
  id: string;
  account_id: string;
  revision: number;
  base_revision: number;
  request_key: string;
  input: LedgerInput;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  output: LedgerReport | null;
  created_at: string;
  updated_at: string;
}
export interface LedgerReport {
  account_id: string;
  account_revision: number;
  baseline_version: number;
  algorithm_version: string;
  input_digest: string;
  event_count: number;
  effective_event_count?: number;
  correction_count?: number;
  projection_version?: "immutable-ledger-corrections-v1";
  valuation: "unpriced";
  result: ReturnType<typeof reconcile>;
}
export interface InvestmentLedgerRepository {
  count(o: LightTickOwner, account: string): Promise<number>;
  latest(o: LightTickOwner, account: string): Promise<LedgerReport | null>;
  events(o: LightTickOwner, accountId: string): Promise<LedgerEvent[]>;
  append(o: LightTickOwner, event: LedgerEvent): Promise<void>;
  get(o: LightTickOwner, id: string): Promise<LedgerWork | undefined>;
  save(row: LedgerWork, base: number): Promise<void>;
  list(o: LightTickOwner, accountId: string): Promise<LedgerWork[]>;
  recoverable(now: string, limit: number): Promise<LedgerWork[]>;
}
