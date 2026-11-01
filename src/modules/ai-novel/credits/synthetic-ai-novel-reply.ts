import { PublicApiMessages, type PublicApiMessageLocale } from "../../../generated/i18n/public-api-messages.generated.ts";
import type { AiNovelChatStreamChunk } from "../ai-novel-llm-types.ts";

export function quotaReply(locale: string | undefined, actionId: string) {
  const language = locale && Object.hasOwn(PublicApiMessages, locale) ? locale as PublicApiMessageLocale : "en-US";
  return {
    text: PublicApiMessages[language]["ai_novel.credits.exhausted"],
    action: { id: actionId, name: "open_membership", arguments: { reason: "quota_insufficient" }, trigger: "after_response_rendered" } as const,
  };
}

/** Deterministic business reply: not an LLM completion or a model tool call. */
export async function* syntheticAiNovelReply(input: {
  locale?: string;
  sceneKey: string;
  actionId: string;
  signal?: AbortSignal;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const reply = quotaReply(input.locale, input.actionId);
  yield* syntheticBusinessReply({ ...input, ...reply, finishReason: "quota_insufficient" });
}

/** Shared, server-owned text/action response; no model or tools are involved. */
export async function* syntheticBusinessReply(input: {
  text: string;
  sceneKey: string;
  finishReason: string;
  action?: Extract<AiNovelChatStreamChunk, { type: "client_action" }>["action"];
  signal?: AbortSignal;
}): AsyncIterable<AiNovelChatStreamChunk> {
  const characters = [...input.text];
  for (let offset = 0; offset < characters.length; offset += 16) {
    if (input.signal?.aborted) return;
    yield { type: "content_delta", text: characters.slice(offset, offset + 16).join("") };
  }
  if (input.signal?.aborted) return;
  if (input.action) yield { type: "client_action", action: input.action };
  if (input.signal?.aborted) return;
  yield { type: "done", completion: { sceneRouteKey: input.sceneKey, content: input.text, finishReason: input.finishReason } };
}
