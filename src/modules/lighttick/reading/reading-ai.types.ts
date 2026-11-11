export interface ReadingSourceRange {
  start: number;
  end: number;
}
export type ReadingSourceBasis =
  | "saved_text"
  | "feed_excerpt"
  | "legacy_unknown";
export interface ReadingAISnapshot {
  prompt_version: "1.1.0";
  guide_format: "reading-v2" | "detailed-v1" | null;
  source_basis: ReadingSourceBasis;
  source_range: ReadingSourceRange;
  input_sha256: string;
  selected_bytes: number;
  prompt_sha256: string;
  messages: { role: "system" | "user"; content: string }[];
}
export interface ReadingAIEvidence {
  guide_format: "reading-v2" | "detailed-v1" | null;
  work_id: string;
  prompt_version: string;
  prompt_sha256: string;
  input_sha256: string;
  output_sha256: string;
  source_basis: ReadingSourceBasis;
  source_range: ReadingSourceRange;
  provider: string;
  model: string;
}
export interface ReadingModelUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_input_tokens: number | null;
  reasoning_tokens: number | null;
  estimated: boolean;
  cost_amount: null;
  cost_currency: null;
  cost_basis: "unknown";
}
