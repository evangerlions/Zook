import type { LightTickOwner } from "../../lighttick.types.ts";
import type { LedgerEvent, LedgerFact } from "../ledger.types.ts";

export const decisionActions = ["buy", "add", "hold", "reduce", "sell", "watch"] as const;
export type EvidenceReference = { kind: "research" | "material"; id: string; revision: number };
export interface DecisionFields {
  instrument_id: string;
  action: (typeof decisionActions)[number];
  reason: string;
  occurred_at: string | null;
  account_id: string | null;
  review_on: string | null;
  counterevidence: string;
  trigger: string;
  target_weight: number | null;
  evidence: EvidenceReference[];
  event_ids: string[];
}
export interface Decision extends DecisionFields {
  id: string;
  revision: number;
  occurred_at: string;
  recorded_at: string;
  updated_at: string;
  backfilled: boolean;
}
export interface DecisionReview {
  id: string;
  decision_id: string;
  decision_revision: number;
  thesis_outcome: "confirmed" | "mixed" | "disproved" | "unknown";
  execution: "followed" | "deviated" | "not_applicable";
  result: string;
  next_step: string;
  recorded_at: string;
}
export interface JournalState {
  revision: number;
  watchlist: string[];
  decisions: Record<string, Decision[]>;
  reviews: Record<string, DecisionReview[]>;
}
export interface JournalRepository {
  get(owner: LightTickOwner): Promise<JournalState | undefined>;
  save(owner: LightTickOwner, state: JournalState, base: number): Promise<void>;
}
export interface JournalFill {
  original: LedgerEvent;
  effective: { id: string; input: LedgerFact | null };
}
