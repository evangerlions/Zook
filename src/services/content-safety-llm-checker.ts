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

export const CONTENT_SAFETY_LLM_SYSTEM_PROMPT = `你是面向中国大陆互联网产品的用户输入内容安全审核器。

任务：只判断“这条用户输入是否应被阻断发送”。不要改写文本，不要补充解释，不要输出自然语言。

你必须调用 submit_content_safety_decision function，且只提交以下字段：
- decision: "pass" 或 "block"
- category: 下方枚举之一

当且仅当用户输入明确命中以下高风险内容时，decision="block"，category 使用下列枚举之一：
1. geopolitics：任何地缘政治、国际政治冲突、国家/地区主权争议、边界争议、外交对抗、制裁、战争冲突、台海/港澳/藏疆等相关内容。只要提及即阻断。
2. national_leaders：任何国家领导人、现任或前任国家元首、政府首脑、党政军最高层人物、其姓名/职务/代称/影射/评价/传闻。只要提及即阻断。
3. political_security：反对宪法基本原则；危害国家安全、泄露国家秘密、颠覆国家政权、破坏国家统一；煽动分裂国家、民族仇恨、地域歧视或破坏民族团结；侮辱英烈；散布会扰乱公共秩序或社会稳定的政治谣言。
4. terrorism_extremism：宣扬、教唆、支持恐怖主义、极端主义、暴力极端组织，或提供相关实施方法、招募、筹资、制造、传播指引。
5. violence_crime：教唆、策划或提供现实违法犯罪方法；制作/购买/交易枪支爆炸物、毒品、管制刀具等违禁品；严重血腥暴力、虐杀、报复社会、校园暴力实施指引。
6. pornography_obscenity：淫秽色情、性交易招嫖、露骨性描写、未成年人性化内容、偷拍传播或非自愿性内容。
7. gambling_drugs_illegal_trade：赌博引流或组织、毒品制售吸食、走私、洗钱、黑灰产、买卖公民信息、证件伪造、刷单诈骗等非法交易。
8. fraud_privacy_abuse：诈骗话术、钓鱼、盗号、绕过风控、恶意攻击、隐私泄露、人肉搜索、骚扰威胁的可执行请求。
9. minors_self_harm_harmful：诱导未成年人违法或危险行为；鼓励自杀自残、厌食伤害、危险挑战，或提供具体实施方法。
10. cult_superstition_harmful：宣扬邪教组织，或以迷信名义实施敛财、控制、恐吓、伤害他人的内容。

不要误判为 block 的情况：
- 正常小说、角色扮演、历史/新闻/政策/法律/学术讨论，只要不涉及地缘政治和国家领导人，也没有现实煽动、组织动员、实施步骤、违法交易或露骨细节。
- 对非政治类公共事件、普通社会问题的理性评论、求助、投诉、事实陈述。
- 非露骨的成人恋爱、普通冲突、轻微打斗、悬疑恐怖气氛、虚构世界观设定。
- 安全教育、反诈提醒、合规风控、内容治理测试样例。

判断原则：
- 地缘政治和国家领导人是零容忍类别，提及即 block。
- 有明确违法有害意图或可执行细节时阻断。
- 只有关键词但语义安全时放行。
- 无法确定时优先 pass，交给关键词层或传统审核 API 兜底。`;

const CONTENT_SAFETY_DECISION_TOOL_NAME = "submit_content_safety_decision";
const CONTENT_SAFETY_DECISION_TOOL = {
  type: "function",
  function: {
    name: CONTENT_SAFETY_DECISION_TOOL_NAME,
    description: "Submit the final moderation decision for one user input.",
    parameters: {
      type: "object",
      additionalProperties: false,
      required: ["decision", "category"],
      properties: {
        decision: {
          type: "string",
          enum: ["pass", "block"],
          description: "Whether the user input should be allowed or blocked.",
        },
        category: {
          type: "string",
          enum: [
            "safe",
            "geopolitics",
            "national_leaders",
            "political_security",
            "terrorism_extremism",
            "violence_crime",
            "pornography_obscenity",
            "gambling_drugs_illegal_trade",
            "fraud_privacy_abuse",
            "minors_self_harm_harmful",
            "cult_superstition_harmful",
          ],
          description: "Use safe when decision is pass; otherwise use the blocking category.",
        },
      },
    },
  },
};

export class LlmContentSafetyChecker {
  constructor(
    private readonly llmManager: LLMManager,
    private readonly callbacks: LlmContentSafetyCheckerCallbacks,
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

    const startedAt = Date.now();
    const llmInput = buildLlmInput(config, text);
    try {
      const result = await withContentSafetyTimeout(this.llmManager.complete(llmInput), config.llm.timeoutMs);
      return await this.handleLlmResult(command, config, text, startedAt, llmInput, result);
    } catch (error) {
      return await this.handleLlmError(command, config, text, startedAt, llmInput, error);
    }
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
