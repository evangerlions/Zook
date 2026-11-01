import type { AiNovelCreditsRequestFlow } from "../../src/modules/ai-novel/credits/ai-novel-credits-request-flow.ts";

// These tests exercise LLM routing/retry internals; charging is covered separately.
export const unmeteredTestCreditsFlow = {
  complete: (_body: unknown, options: unknown, execute: (options: any) => unknown) => execute(options),
  stream: (_body: unknown, options: unknown, execute: (options: any) => unknown) => execute(options),
  embeddings: (_body: unknown, options: unknown, execute: (options: any) => unknown) => execute(options),
} as unknown as AiNovelCreditsRequestFlow;
