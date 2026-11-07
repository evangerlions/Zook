import type { LightTickOwner } from "../../lighttick.types.ts";
export const researchFields = [
  "market_context",
  "technical_case",
  "catalyst",
  "company_risk",
  "valuation_assumptions",
  "liquidity",
  "nav_context",
  "portfolio_impact",
  "contrary_case",
  "missing_inputs",
] as const;
export interface ResearchEvidence {
  title: string;
  content: string;
  locator: string;
  source_url: string | null;
  available_at: string;
  contrary_evidence: string;
}
export interface ResearchMarketSource {
  id: string;
  version: 1;
  input_digest: string;
}
export type ResearchEntry = Record<(typeof researchFields)[number], string> & {
  id: string;
  revision: number;
  request_key: string;
  instrument_id: string;
  account_id: string | null;
  title: string;
  horizon: "short" | "swing";
  evidence: ResearchEvidence[];
  market_sources: ResearchMarketSource[];
  material_sources?: import("../materials/material.types.ts").MaterialSource[];
  archived: boolean;
  created_at: string;
  updated_at: string;
};
export type ResearchSummary = Pick<
  ResearchEntry,
  | "id"
  | "revision"
  | "instrument_id"
  | "account_id"
  | "title"
  | "horizon"
  | "archived"
  | "updated_at"
>;
export const researchSummary = (e: ResearchEntry): ResearchSummary => ({
  id: e.id,
  revision: e.revision,
  instrument_id: e.instrument_id,
  account_id: e.account_id,
  title: e.title,
  horizon: e.horizon,
  archived: e.archived,
  updated_at: e.updated_at,
});
export interface ResearchRepository {
  get(o: LightTickOwner, id: string): Promise<ResearchEntry | undefined>;
  list(o: LightTickOwner, instrument?: string): Promise<ResearchSummary[]>;
  versions(
    o: LightTickOwner,
    id: string,
    before: number,
    limit: number,
  ): Promise<ResearchEntry[]>;
  save(o: LightTickOwner, entry: ResearchEntry, base: number): Promise<void>;
}
