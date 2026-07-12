import type {
  LLMCompletionRequest,
  LLMToolCall,
  LLMUsage,
} from "./llm-manager-types.ts";

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

  constructor(private readonly promptTokens = 0) {}

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
    if (this.promptTokens <= 0 && completionTokens <= 0) {
      return undefined;
    }
    return {
      promptTokens: this.promptTokens,
      completionTokens,
      totalTokens: this.promptTokens + completionTokens,
      ...(reasoningTokens > 0 ? { reasoningTokens } : {}),
      estimated: true,
    };
  }
}

export function estimateCompletionUsage(result: {
  text?: string;
  reasoningText?: string;
  toolCalls?: LLMToolCall[];
}, request: Pick<LLMCompletionRequest, "messages" | "providerOptions">): LLMUsage | undefined {
  const accumulator = createUsageEstimateAccumulator(request);
  accumulator.addContentDelta(result.text ?? "");
  accumulator.addReasoningDelta(result.reasoningText ?? "");
  for (const toolCall of result.toolCalls ?? []) {
    accumulator.addFinalToolCall(toolCall);
  }
  return accumulator.toUsageFallback();
}

export function createUsageEstimateAccumulator(
  request: Pick<LLMCompletionRequest, "messages" | "providerOptions">,
): LLMUsageEstimateAccumulator {
  return new LLMUsageEstimateAccumulator(estimateTokens(JSON.stringify({
    messages: request.messages,
    providerOptions: request.providerOptions,
  })));
}

export function estimateEmbeddingUsage(input: string[]): LLMUsage {
  const promptTokens = input.reduce((sum, item) => sum + estimateTokens(item), 0);
  return {
    promptTokens,
    completionTokens: 0,
    totalTokens: promptTokens,
    estimated: true,
  };
}
