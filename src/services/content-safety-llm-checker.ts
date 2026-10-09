import { JevContentSafetyClient, buildJevModerationBody } from "./jev-content-safety-client.ts";
import { CONTENT_SAFETY_LLM_SYSTEM_PROMPT, CONTENT_SAFETY_DECISION_TOOL, CONTENT_SAFETY_DECISION_TOOL_NAME } from "./content-safety-llm-rules.ts";
export { CONTENT_SAFETY_LLM_SYSTEM_PROMPT } from "./content-safety-llm-rules.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { AdminContentSafetyTestDocument, ContentSafetyConfig } from "../shared/types.ts";
import { LLMManager, type LLMCompletionResult } from "./llm-manager.ts";
import {
  describeContentSafetyFailure,
  withContentSafetyTimeout,
} from "./content-safety-helpers.ts";
import type {
  ContentSafetyCheckCommand,
  ContentSafetyCheckResult,
  ContentSafetyDecisionLogger,
  ContentSafetyRecordInput,
  ContentSafetyThrowSensitive,
} from "./content-safety-types.ts";

type ParsedLlmDecision =
  | { parsed: true; blocked: boolean; category?: string }
  | { parsed: false; reason: string; detail: string };

interface LlmContentSafetyCheckerCallbacks {
  recordCheck(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    input: ContentSafetyRecordInput,
  ): Promise<void>;
  logDecision: ContentSafetyDecisionLogger;
  throwSensitive: ContentSafetyThrowSensitive;
}

export class LlmContentSafetyChecker {
  constructor(
    private readonly llmManager: LLMManager,
    private readonly callbacks: LlmContentSafetyCheckerCallbacks,
    private readonly jevClient?: JevContentSafetyClient,
  ) {}

  async check(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
  ): Promise<ContentSafetyCheckResult> {
    if (!config.llm.enabled) {
      await this.callbacks.recordCheck(command, config, {
        method: "llm",
        decision: "pass",
        text,
        metadata: { disabled: true },
      });
      return { allowed: true, layer: "llm" };
    }

    if (config.llm.useJev) config = { ...config, llm: { ...config.llm, modelKey: "jev-1.13" } };
    const startedAt = Date.now();
    const llmInput = buildLlmInput(config, text);
    try {
      const result = await withContentSafetyTimeout(config.llm.useJev
        ? this.requireJevClient().complete(text, config.llm.timeoutMs)
        : this.llmManager.complete({ ...llmInput, callPurpose: "content_safety" }), config.llm.timeoutMs);
      return await this.handleLlmResult(command, config, text, startedAt, llmInput, result);
    } catch (error) {
      return await this.handleLlmError(command, config, text, startedAt, llmInput, error);
    }
  }

  private requireJevClient(): JevContentSafetyClient {
    if (!this.jevClient) throw new Error("Jev moderation client is not configured");
    return this.jevClient;
  }

  private async handleLlmResult(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
    startedAt: number,
    llmInput: NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"],
    result: LLMCompletionResult,
  ): Promise<ContentSafetyCheckResult> {
    const decision = parseLlmDecision(result);
    const latencyMs = Date.now() - startedAt;
    const llmDebug = buildLlmDebug(llmInput, result, decision, latencyMs);
    if (!decision.parsed) {
      this.callbacks.logDecision("warn", "content safety llm output parse failed open", command, config, "llm", {
        decision: "failed_open",
        latencyMs,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
        failureReason: decision.reason,
        failureDetail: decision.detail,
      });
      await this.callbacks.recordCheck(command, config, {
        method: "failed_open",
        decision: "failed_open",
        text,
        latencyMs,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
        failureReason: decision.reason,
        failureDetail: decision.detail,
      });
      return {
        allowed: true,
        layer: "failed_open",
        failureReason: decision.reason,
        failureDetail: decision.detail,
        llmDebug,
      };
    }

    this.callbacks.logDecision("info", "content safety llm checked user input", command, config, "llm", {
      decision: decision.blocked ? "block" : "pass",
      category: decision.category,
      latencyMs,
      modelKey: result.modelKey,
      provider: result.provider,
      providerModel: result.providerModel,
    });
    await this.recordParsedDecision(command, config, text, result, decision, latencyMs, llmDebug);
    return { allowed: true, layer: "llm", llmDebug };
  }

  private async recordParsedDecision(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
    result: LLMCompletionResult,
    decision: Extract<ParsedLlmDecision, { parsed: true }>,
    latencyMs: number,
    llmDebug: AdminContentSafetyTestDocument["llmDebug"],
  ): Promise<void> {
    if (decision.blocked) {
      await this.callbacks.recordCheck(command, config, {
        method: "llm",
        decision: "block",
        text,
        blockedText: text,
        category: decision.category,
        latencyMs,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
        metadata: result.usage ? { usage: result.usage } : {},
      });
      this.callbacks.throwSensitive("llm", decision.category, llmDebug);
    }
    await this.callbacks.recordCheck(command, config, {
      method: "llm",
      decision: "pass",
      text,
      category: decision.category,
      latencyMs,
      modelKey: result.modelKey,
      provider: result.provider,
      providerModel: result.providerModel,
      metadata: result.usage ? { usage: result.usage } : {},
    });
  }

  private async handleLlmError(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
    startedAt: number,
    llmInput: NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"],
    error: unknown,
  ): Promise<ContentSafetyCheckResult> {
    if (error instanceof ApplicationError && error.code === "AI_INPUT_CONTENT_SENSITIVE") {
      throw error;
    }
    if (error instanceof ApplicationError && error.code === "LLM_PROVIDER_CONTENT_SENSITIVE") {
      await this.handleProviderSensitiveError(command, config, text, startedAt, llmInput, error);
    }
    const failure = describeContentSafetyFailure(error);
    this.callbacks.logDecision("warn", "content safety llm failed open", command, config, "llm", {
      decision: "failed_open",
      latencyMs: Date.now() - startedAt,
      modelKey: config.llm.modelKey,
      timeoutMs: config.llm.timeoutMs,
      failureReason: failure.reason,
      failureDetail: failure.detail,
      errorName: failure.errorName,
      errorCode: failure.errorCode,
      statusCode: failure.statusCode,
    });
    await this.callbacks.recordCheck(command, config, {
      method: "failed_open",
      decision: "failed_open",
      text,
      latencyMs: Date.now() - startedAt,
      modelKey: config.llm.modelKey,
      failureReason: failure.reason,
      failureDetail: failure.detail,
      metadata: {
        errorName: failure.errorName,
        errorCode: failure.errorCode,
        statusCode: failure.statusCode,
      },
    });
    return {
      allowed: true,
      layer: "failed_open",
      failureReason: failure.reason,
      failureDetail: failure.detail,
      llmDebug: {
        latencyMs: Date.now() - startedAt,
        input: llmInput,
      },
    };
  }

  private async handleProviderSensitiveError(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
    startedAt: number,
    llmInput: NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"],
    error: ApplicationError,
  ): Promise<never> {
    const latencyMs = Date.now() - startedAt;
    const category = "provider_data_inspection";
    const failure = describeContentSafetyFailure(error);
    this.callbacks.logDecision("warn", "content safety llm provider precheck rejected user input", command, config, "llm", {
      decision: "block",
      category,
      latencyMs,
      modelKey: config.llm.modelKey,
      timeoutMs: config.llm.timeoutMs,
      failureReason: failure.reason,
      failureDetail: failure.detail,
      errorCode: failure.errorCode,
      statusCode: failure.statusCode,
    });
    await this.callbacks.recordCheck(command, config, {
      method: "llm",
      decision: "block",
      text,
      blockedText: text,
      category,
      latencyMs,
      modelKey: config.llm.modelKey,
      failureReason: failure.reason,
      failureDetail: failure.detail,
      metadata: {
        errorCode: failure.errorCode,
        statusCode: failure.statusCode,
      },
    });
    this.callbacks.throwSensitive("llm", category, {
      latencyMs,
      input: llmInput,
      output: {
        provider: "bailian",
        modelKey: config.llm.modelKey,
        providerModel: config.llm.modelKey,
        text: "",
        parseError: {
          reason: failure.reason,
          detail: failure.detail,
        },
      },
    });
  }
}

function buildLlmInput(config: ContentSafetyConfig, text: string) {
  return {
    modelKey: config.llm.modelKey,
    temperature: 0,
    maxTokens: 80,
    timeoutMs: config.llm.timeoutMs,
    providerOptions: {
      enable_thinking: false,
      zookLogBodyMode: "redacted",
      ...(config.llm.useJev ? { endpoint: "decisions", questions: buildJevModerationBody(text).questions } : {}),
      tools: [CONTENT_SAFETY_DECISION_TOOL],
      tool_choice: {
        type: "function",
        function: { name: CONTENT_SAFETY_DECISION_TOOL_NAME },
      },
    },
    messages: [
      {
        role: "system",
        content: CONTENT_SAFETY_LLM_SYSTEM_PROMPT,
      },
      {
        role: "user",
        content: `审核下面的用户输入：\n${text}`,
      },
    ],
  } satisfies NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"];
}

function buildLlmDebug(
  input: NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"],
  result: LLMCompletionResult,
  decision: ParsedLlmDecision,
  latencyMs: number,
): NonNullable<AdminContentSafetyTestDocument["llmDebug"]> {
  return {
    latencyMs,
    input,
    output: {
      provider: result.provider,
      modelKey: result.modelKey,
      providerModel: result.providerModel,
      text: result.text,
      ...(result.toolCalls ? { toolCalls: result.toolCalls } : {}),
      ...(result.reasoningText ? { reasoningText: result.reasoningText } : {}),
      ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      ...(result.providerRequestId ? { providerRequestId: result.providerRequestId } : {}),
      ...(result.usage ? { usage: result.usage as unknown as Record<string, unknown> } : {}),
      ...(decision.parsed ? { parsedDecision: { blocked: decision.blocked, category: decision.category } } : {
        parseError: {
          reason: decision.reason,
          detail: decision.detail,
        },
      }),
    },
  };
}

function parseLlmDecision(result: Pick<LLMCompletionResult, "text" | "toolCalls">): ParsedLlmDecision {
  const decisionToolCall = result.toolCalls?.find((toolCall) =>
    toolCall.name === CONTENT_SAFETY_DECISION_TOOL_NAME
  );
  if (decisionToolCall) {
    return parseLlmDecisionObject(decisionToolCall.input);
  }

  return {
    parsed: false,
    reason: "llm_tool_call_missing",
    detail:
      `LLM moderation output did not call ${CONTENT_SAFETY_DECISION_TOOL_NAME}. Text output: ${
        result.text.trim().slice(0, 500) || "<empty>"
      }`,
  };
}

function parseLlmDecisionObject(parsed: Record<string, unknown>): ParsedLlmDecision {
  const decision = typeof parsed.decision === "string" ? parsed.decision.toLowerCase() : "";
  if (decision !== "pass" && decision !== "block") {
    return {
      parsed: false,
      reason: "llm_output_parse_failed",
      detail: `LLM moderation output has invalid decision: ${decision || "<empty>"}.`,
    };
  }
  return {
    parsed: true,
    blocked: decision === "block",
    category: typeof parsed.category === "string" ? parsed.category.slice(0, 80) : undefined,
  };
}
