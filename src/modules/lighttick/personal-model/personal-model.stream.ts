import type { LLMUsage } from "../../../services/llm-manager-types.ts";
import { parseOpenAICompatibleChatUsage } from "../../../services/openai-compatible-usage.ts";
export interface PersonalStreamResult {
  text: string;
  finishReason?: string;
  usage?: LLMUsage;
}
/**
 * Minimal OpenAI-compatible SSE reader for personal gateways.
 *
 * Deliberately not reusing `parseBailianOpenAICompatibleStream`: that parser throws
 * when the stream ends without `[DONE]`, carries tool-call accounting, and reports
 * Bailian-branded errors. Personal gateways are inconsistent about the sentinel,
 * so end-of-body is accepted as end-of-stream here. Comment lines (`:` keep-alives)
 * and unparseable chunks are skipped rather than failing a paid generation.
 */
export async function readPersonalModelStream(
  response: Response,
  options: { onContentDelta?: (delta: string, fullText: string) => void } = {},
): Promise<PersonalStreamResult> {
  if (!response.body) throw Error("MODEL_RESPONSE_INCOMPLETE");
  const reader = response.body.getReader(),
    decoder = new TextDecoder("utf-8");
  let buffer = "",
    text = "",
    finishReason: string | undefined,
    usage: LLMUsage | undefined;
  const consume = (line: string) => {
    const trimmed = line.replace(/\r$/, "");
    if (!trimmed.startsWith("data:")) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") return;
    let event: any;
    try {
      event = JSON.parse(payload);
    } catch {
      return;
    }
    const choice = event?.choices?.[0],
      delta = choice?.delta?.content;
    if (typeof delta === "string" && delta) {
      text += delta;
      if (options.onContentDelta) {
        try {
          options.onContentDelta(delta, text);
        } catch {
          /* observer failure is not a generation failure */
        }
      }
    }
    if (typeof choice?.finish_reason === "string")
      finishReason = choice.finish_reason;
    if (event?.usage)
      usage = parseOpenAICompatibleChatUsage(event.usage, "personal") ?? usage;
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        consume(buffer.slice(0, index));
        buffer = buffer.slice(index + 1);
      }
    }
    buffer += decoder.decode();
    if (buffer) consume(buffer);
  } finally {
    try {
      reader.releaseLock();
    } catch {
      /* already released */
    }
  }
  return { text, ...(finishReason ? { finishReason } : {}), ...(usage ? { usage } : {}) };
}
