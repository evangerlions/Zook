import type { AiNovelChatStreamChunk } from "../ai-novel-llm-types.ts";
import { quotaReply } from "./synthetic-ai-novel-reply.ts";

/** Display the existing notice in 1.5's import progress, then stop its agent loop. */
export async function* legacyImportQuotaReply(input: {
  locale?: string;
  actionId: string;
  signal?: AbortSignal;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const { text } = quotaReply(input.locale, input.actionId, true);
  if (input.signal?.aborted) return;
  yield { type: "tool_call_delta", text };
  if (input.signal?.aborted) return;
  yield { type: "error", payload: { code: "AINOVEL_QUOTA_INSUFFICIENT", message: text, recoverable: false } };
}
