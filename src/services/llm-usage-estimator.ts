import type { LLMToolCall, LLMUsage } from "./llm-manager-types.ts";

const CHARS_PER_TOKEN = 3;

function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.max(1, Math.ceil([...text].length / CHARS_PER_TOKEN));
}

function serializeToolCall(toolCall: LLMToolCall): string {
  return JSON.stringify({
    name: toolCall.name,
    input: toolCall.input,
  });
}

export class LLMUsageEstimateAccumulator {
  private reasoningText = "";
  private contentText = "";
  private toolDeltaText = "";
  private finalToolCallText = "";

  addReasoningDelta(text: string): void {
    this.reasoningText += text;
  }

  addContentDelta(text: string): void {
    this.contentText += text;
  }

  addToolCallDelta(text: string): void {
    this.toolDeltaText += text;
  }

  addFinalToolCall(toolCall: LLMToolCall): void {
    this.finalToolCallText += serializeToolCall(toolCall);
  }

  toUsageFallback(): LLMUsage | undefined {
    const reasoningTokens = estimateTokens(this.reasoningText);
    const contentTokens = estimateTokens(this.contentText);
    const toolTokens = estimateTokens(
      this.toolDeltaText || this.finalToolCallText,
    );
    const completionTokens = reasoningTokens + contentTokens + toolTokens;
    if (completionTokens <= 0) {
      return undefined;
    }
    return {
      promptTokens: 0,
      completionTokens,
      totalTokens: completionTokens,
      ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      estimated: true,
    };
  }
}

export function estimateCompletionUsage(result: {
  text?: string;
  reasoningText?: string;
  toolCalls?: LLMToolCall[];
}): LLMUsage | undefined {
  const accumulator = new LLMUsageEstimateAccumulator();
  accumulator.addContentDelta(result.text ?? "");
  accumulator.addReasoningDelta(result.reasoningText ?? "");
  for (const toolCall of result.toolCalls ?? []) {
    accumulator.addFinalToolCall(toolCall);
  }
  return accumulator.toUsageFallback();
}
