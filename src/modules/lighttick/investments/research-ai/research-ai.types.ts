import type { InvestmentInstrument } from "../investment.types.ts";
import type { LightTickOwner } from "../../lighttick.types.ts";
import type { ResearchEntry } from "../research/research.types.ts";
import type { MarketSnapshot } from "../market/market-work.types.ts";
import type { ModelSelection } from "../../personal-model/personal-model.types.ts";
export interface ResearchAIWork extends LightTickOwner {
  id: string;
  revision: number;
  request_key: string;
  kind: "analysis" | "guide" | "report";
  input: {
    scene: typeof RESEARCH_AI_SCENE;
    instrument: InvestmentInstrument;
    research: ResearchEntry;
    markets: MarketSnapshot[];
    materials?: import("../materials/material.types.ts").Material[];
    model: ModelSelection;
    digest: string;
  };
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
  attempt: number;
  fence: string | null;
  lease_until: string | null;
  error_code: string | null;
  output: {
    text: string;
    citations: string[];
    limitations: string;
    provider: string;
    model: string;
    prompt_version: string;
  } | null;
  adopted_at: string | null;
  created_at: string;
  updated_at: string;
}
export interface ResearchAIRepository {
  get(o: LightTickOwner, id: string): Promise<ResearchAIWork | undefined>;
  save(w: ResearchAIWork, base: number): Promise<void>;
  list(o: LightTickOwner): Promise<ResearchAIWork[]>;
  recoverable(now: string): Promise<ResearchAIWork[]>;
}
export const publicWork = ({
  appId,
  userId,
  fence,
  lease_until,
  ...w
}: ResearchAIWork) => w;

export const RESEARCH_AI_SCENE = {
  key: "lighttick.research.v1",
  prompt_version: "research-ai-v1",
  model_alias: "novel-structured",
  max_output_tokens: 2500,
  max_input_bytes: 18000,
  timeout_ms: 30000,
} as const;
