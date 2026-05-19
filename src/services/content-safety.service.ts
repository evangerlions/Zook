import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminContentSafetyTestDocument,
  ContentSafetyConfig,
  ContentSafetyKeywordRule,
} from "../shared/types.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { CommonContentSafetyConfigService } from "./common-content-safety-config.service.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { LLMManager } from "./llm-manager.ts";
import { sendAliyunTextModerationRequest } from "./aliyun-content-safety-request.ts";

export const AI_INPUT_CONTENT_SENSITIVE_MESSAGE = "这段内容暂时无法发送，请调整后再试。";

export interface ContentSafetyCheckCommand {
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  text: string;
}

export interface ContentSafetyCheckResult {
  allowed: boolean;
  layer: "disabled" | "empty" | "keyword" | "llm" | "aliyun" | "failed_open";
  failureReason?: string;
  failureDetail?: string;
  llmDebug?: AdminContentSafetyTestDocument["llmDebug"];
}

type ContentSafetyDecisionLayer = "keyword" | "llm" | "aliyun";
type ParsedLlmDecision =
  | { parsed: true; blocked: boolean; category?: string }
  | { parsed: false; reason: string; detail: string };

export class ContentSafetyService {
  constructor(
    private readonly configService: CommonContentSafetyConfigService,
    private readonly llmManager: LLMManager,
    private readonly passwordConfigService: CommonPasswordConfigService,
    private readonly logger?: StructuredLogger,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async assertUserInputAllowed(command: ContentSafetyCheckCommand): Promise<ContentSafetyCheckResult> {
    const text = command.text.trim();
    if (!text) {
      return { allowed: true, layer: "empty" };
    }

    const config = await this.configService.getCurrentConfig();
    if (!config.enabled) {
      return { allowed: true, layer: "disabled" };
    }

    const keywordDecision = this.checkKeywords(text, config.keyword.rules, config.keyword.enabled);
    if (keywordDecision.blocked) {
      this.logDecision("warn", "content safety rejected user input", command, config, "keyword", {
        decision: "block",
        category: keywordDecision.category,
        keywordId: keywordDecision.keywordId,
      });
      this.throwSensitive("keyword", keywordDecision.category, undefined, keywordDecision.keywordId);
    }

    if (text.length > config.longTextThresholdChars) {
      return this.checkAliyun(command, config, text);
    }

    return this.checkLlm(command, config, text);
  }

  async testUserInput(command: ContentSafetyCheckCommand): Promise<AdminContentSafetyTestDocument> {
    try {
      const result = await this.assertUserInputAllowed(command);
      return {
        allowed: true,
        blocked: false,
        layer: result.layer,
        code: "OK",
        message: result.layer === "failed_open" ? "审核服务未完成，已按 fail-open 策略放行" : "允许发送",
        textLength: command.text.length,
        ...(result.failureReason ? { failureReason: result.failureReason } : {}),
        ...(result.failureDetail ? { failureDetail: result.failureDetail } : {}),
        ...(result.llmDebug ? { llmDebug: result.llmDebug } : {}),
      };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "AI_INPUT_CONTENT_SENSITIVE") {
        const details = error.details && typeof error.details === "object"
          ? error.details as Record<string, unknown>
          : {};
        const layer = typeof details.layer === "string" ? details.layer : "keyword";
        return {
          allowed: false,
          blocked: true,
          layer: isContentSafetyLayer(layer) ? layer : "keyword",
          code: "AI_INPUT_CONTENT_SENSITIVE",
          message: error.message,
          textLength: command.text.length,
          ...(typeof details.category === "string" ? { category: details.category } : {}),
          ...(typeof details.keywordId === "string" ? { keywordId: details.keywordId } : {}),
          ...(isLlmDebug(details.llmDebug) ? { llmDebug: details.llmDebug } : {}),
        };
      }
      throw error;
    }
  }

  private checkKeywords(
    text: string,
    rules: ContentSafetyKeywordRule[],
    enabled: boolean,
  ): { blocked: boolean; keywordId?: string; category?: string } {
    if (!enabled) {
      return { blocked: false };
    }

    const normalizedText = normalizeText(text);
    const matched = rules
      .filter((rule) => rule.enabled)
      .find((rule) => normalizedText.includes(normalizeText(rule.term)));
    if (!matched) {
      return { blocked: false };
    }

    return {
      blocked: true,
      keywordId: matched.id,
      category: matched.category,
    };
  }

  private async checkLlm(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
  ): Promise<ContentSafetyCheckResult> {
    if (!config.llm.enabled) {
      return { allowed: true, layer: "llm" };
    }

    const startedAt = Date.now();
    const llmInput = {
      modelKey: config.llm.modelKey,
      temperature: 0,
      maxTokens: 80,
      timeoutMs: config.llm.timeoutMs,
      providerOptions: {
        enable_thinking: false,
        zookLogBodyMode: "redacted",
      },
      messages: [
        {
          role: "system",
          content:
            "你是内容安全审核器。只判断用户输入是否需要阻断。返回严格 JSON：{\"decision\":\"pass\"|\"block\",\"category\":\"...\"}。不要输出解释。",
        },
        {
          role: "user",
          content: `审核下面的用户输入：\n${text}`,
        },
      ],
    } satisfies NonNullable<AdminContentSafetyTestDocument["llmDebug"]>["input"];
    try {
      const result = await withTimeout(this.llmManager.complete(llmInput), config.llm.timeoutMs);
      const decision = parseLlmDecision(result.text);
      const llmDebug = {
        input: llmInput,
        output: {
          provider: result.provider,
          modelKey: result.modelKey,
          providerModel: result.providerModel,
          text: result.text,
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
      } satisfies NonNullable<AdminContentSafetyTestDocument["llmDebug"]>;
      if (!decision.parsed) {
        this.logDecision("warn", "content safety llm output parse failed open", command, config, "llm", {
          decision: "failed_open",
          latencyMs: Date.now() - startedAt,
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
      this.logDecision("info", "content safety llm checked user input", command, config, "llm", {
        decision: decision.blocked ? "block" : "pass",
        category: decision.category,
        latencyMs: Date.now() - startedAt,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
      });
      if (decision.blocked) {
        this.throwSensitive("llm", decision.category, llmDebug);
      }
      return { allowed: true, layer: "llm", llmDebug };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "AI_INPUT_CONTENT_SENSITIVE") {
        throw error;
      }
      const failure = describeFailure(error);
      this.logDecision("warn", "content safety llm failed open", command, config, "llm", {
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
      return {
        allowed: true,
        layer: "failed_open",
        failureReason: failure.reason,
        failureDetail: failure.detail,
        llmDebug: {
          input: llmInput,
        },
      };
    }
  }

  private async checkAliyun(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    text: string,
  ): Promise<ContentSafetyCheckResult> {
    if (!config.aliyun.enabled) {
      this.logDecision("warn", "content safety aliyun disabled for long input", command, config, "aliyun", {
        decision: "failed_open",
        reason: "disabled",
        failureReason: "aliyun_disabled",
        failureDetail: "Long text matched the Aliyun branch, but Aliyun content safety is disabled.",
      });
      return {
        allowed: true,
        layer: "failed_open",
        failureReason: "aliyun_disabled",
        failureDetail: "Long text matched the Aliyun branch, but Aliyun content safety is disabled.",
      };
    }

    const accessKeyId = await this.passwordConfigService.getValue(config.aliyun.accessKeyIdPasswordKey);
    const accessKeySecret = await this.passwordConfigService.getValue(config.aliyun.accessKeySecretPasswordKey);
    if (!accessKeyId || !accessKeySecret) {
      this.logDecision("warn", "content safety aliyun credentials missing", command, config, "aliyun", {
        decision: "failed_open",
        reason: "missing_password_reference",
        accessKeyIdPasswordKey: config.aliyun.accessKeyIdPasswordKey,
        accessKeySecretPasswordKey: config.aliyun.accessKeySecretPasswordKey,
        hasAccessKeyId: Boolean(accessKeyId),
        hasAccessKeySecret: Boolean(accessKeySecret),
        failureReason: "aliyun_credentials_missing",
        failureDetail: "Aliyun content safety is enabled, but one or more PASSWORD references resolved to an empty value.",
      });
      return {
        allowed: true,
        layer: "failed_open",
        failureReason: "aliyun_credentials_missing",
        failureDetail: "Aliyun content safety is enabled, but one or more PASSWORD references resolved to an empty value.",
      };
    }

    const startedAt = Date.now();
    try {
      const result = await sendAliyunTextModerationRequest({
        endpoint: config.aliyun.endpoint,
        region: config.aliyun.region,
        service: config.aliyun.service,
        credentials: {
          accessKeyId,
          accessKeySecret,
        },
        text,
        timeoutMs: config.aliyun.timeoutMs,
      }, this.fetchImplementation);
      this.logDecision("info", "content safety aliyun checked user input", command, config, "aliyun", {
        decision: result.blocked ? "block" : "pass",
        category: result.category,
        providerRequestId: result.providerRequestId,
        latencyMs: Date.now() - startedAt,
      });
      if (result.blocked) {
        this.throwSensitive("aliyun", result.category);
      }
      return { allowed: true, layer: "aliyun" };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "AI_INPUT_CONTENT_SENSITIVE") {
        throw error;
      }
      const failure = describeFailure(error);
      this.logDecision("warn", "content safety aliyun failed open", command, config, "aliyun", {
        decision: "failed_open",
        latencyMs: Date.now() - startedAt,
        endpoint: config.aliyun.endpoint,
        region: config.aliyun.region,
        service: config.aliyun.service,
        timeoutMs: config.aliyun.timeoutMs,
        failureReason: failure.reason,
        failureDetail: failure.detail,
        errorName: failure.errorName,
        errorCode: failure.errorCode,
        statusCode: failure.statusCode,
      });
      return {
        allowed: true,
        layer: "failed_open",
        failureReason: failure.reason,
        failureDetail: failure.detail,
      };
    }
  }

  private throwSensitive(
    layer: ContentSafetyDecisionLayer,
    category?: string,
    llmDebug?: AdminContentSafetyTestDocument["llmDebug"],
    keywordId?: string,
  ): never {
    throw new ApplicationError(422, "AI_INPUT_CONTENT_SENSITIVE", AI_INPUT_CONTENT_SENSITIVE_MESSAGE, {
      layer,
      ...(category ? { category } : {}),
      ...(llmDebug ? { llmDebug } : {}),
      ...(keywordId ? { keywordId } : {}),
    });
  }

  private logDecision(
    level: "info" | "warn",
    message: string,
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    layer: ContentSafetyDecisionLayer,
    context: Record<string, unknown>,
  ): void {
    const payload = {
      appId: command.appId,
      userId: command.userId,
      requestId: command.requestId,
      taskType: command.taskType,
      layer,
      length: command.text.length,
      inputHash: hashText(command.text),
      thresholdChars: config.longTextThresholdChars,
      keywordEnabled: config.keyword.enabled,
      llmEnabled: config.llm.enabled,
      llmModelKey: config.llm.modelKey,
      llmTimeoutMs: config.llm.timeoutMs,
      aliyunEnabled: config.aliyun.enabled,
      aliyunEndpoint: config.aliyun.endpoint,
      aliyunRegion: config.aliyun.region,
      aliyunService: config.aliyun.service,
      aliyunTimeoutMs: config.aliyun.timeoutMs,
      ...context,
    };
    if (level === "warn") {
      this.logger?.warn(message, payload);
      return;
    }
    this.logger?.info(message, payload);
  }
}

function parseLlmDecision(text: string): ParsedLlmDecision {
  const trimmed = text.trim();
  const jsonText = trimmed.match(/\{[\s\S]*\}/)?.[0] ?? trimmed;
  try {
    const parsed = JSON.parse(jsonText) as Record<string, unknown>;
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
  } catch (error) {
    return {
      parsed: false,
      reason: "llm_output_parse_failed",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
}

function hashText(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function describeFailure(error: unknown): {
  reason: string;
  detail: string;
  errorName?: string;
  errorCode?: string;
  statusCode?: number;
} {
  if (error instanceof ApplicationError) {
    return {
      reason: error.code,
      detail: error.message,
      errorName: error.name,
      errorCode: error.code,
      statusCode: error.statusCode,
    };
  }
  if (error instanceof Error) {
    return {
      reason: error.name || "Error",
      detail: error.message,
      errorName: error.name,
    };
  }
  return {
    reason: "unknown_error",
    detail: String(error),
  };
}

function isContentSafetyLayer(
  value: string,
): value is AdminContentSafetyTestDocument["layer"] {
  return [
    "disabled",
    "empty",
    "keyword",
    "llm",
    "aliyun",
    "failed_open",
  ].includes(value);
}

function isLlmDebug(value: unknown): value is NonNullable<AdminContentSafetyTestDocument["llmDebug"]> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "input" in value);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("content safety LLM timeout")), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
