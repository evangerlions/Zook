import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminContentSafetyBlockRecordsDocument,
  AdminContentSafetyStatsDocument,
  AdminContentSafetyTestDocument,
  ContentSafetyConfig,
  ContentSafetyKeywordRule,
} from "../shared/types.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { CommonContentSafetyConfigService } from "./common-content-safety-config.service.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { LLMManager } from "./llm-manager.ts";
import { sendAliyunTextModerationRequest } from "./aliyun-content-safety-request.ts";
import {
  describeContentSafetyFailure,
  hashContentSafetyText,
  isContentSafetyLayer,
  isLlmDebug,
  normalizeSafetyText,
} from "./content-safety-helpers.ts";
import { LlmContentSafetyChecker } from "./content-safety-llm-checker.ts";
import { ContentSafetyRecordStore } from "./content-safety-records.ts";
import type {
  ContentSafetyCheckCommand,
  ContentSafetyCheckResult,
  ContentSafetyDecisionLayer,
  ContentSafetyStatsFilter,
} from "./content-safety-types.ts";

export type {
  ContentSafetyCheckCommand,
  ContentSafetyCheckResult,
  ContentSafetyStatsFilter,
} from "./content-safety-types.ts";

export const AI_INPUT_CONTENT_SENSITIVE_MESSAGE = "这段内容暂时无法发送，请调整后再试。";

export class ContentSafetyService {
  private readonly records: ContentSafetyRecordStore;
  private readonly llmChecker: LlmContentSafetyChecker;

  constructor(
    private readonly configService: CommonContentSafetyConfigService,
    llmManager: LLMManager,
    private readonly passwordConfigService: CommonPasswordConfigService,
    database: ApplicationDatabase,
    private readonly logger?: StructuredLogger,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {
    this.records = new ContentSafetyRecordStore(database, logger);
    this.llmChecker = new LlmContentSafetyChecker(llmManager, {
      recordCheck: (command, config, input) => this.records.recordCheck(command, config, input),
      logDecision: (level, message, command, config, layer, context) =>
        this.logDecision(level, message, command, config, layer, context),
      throwSensitive: (layer, category, llmDebug, keywordId) =>
        this.throwSensitive(layer, category, llmDebug, keywordId),
    });
  }

  async assertUserInputAllowed(command: ContentSafetyCheckCommand): Promise<ContentSafetyCheckResult> {
    const text = command.text.trim();
    if (!text) {
      return { allowed: true, layer: "empty" };
    }

    const config = await this.configService.getCurrentConfig();
    if (!config.enabled) {
      await this.records.recordCheck(command, config, {
        method: "disabled",
        decision: "pass",
        text,
      });
      return { allowed: true, layer: "disabled" };
    }

    const keywordDecision = this.checkKeywords(text, config.keyword.rules, config.keyword.enabled);
    if (keywordDecision.blocked) {
      this.logDecision("warn", "content safety rejected user input", command, config, "keyword", {
        decision: "block",
        category: keywordDecision.category,
        keywordId: keywordDecision.keywordId,
      });
      await this.records.recordCheck(command, config, {
        method: "keyword",
        decision: "block",
        text,
        blockedText: text,
        category: keywordDecision.category,
        keywordId: keywordDecision.keywordId,
      });
      this.throwSensitive("keyword", keywordDecision.category, undefined, keywordDecision.keywordId);
    }

    if (text.length > config.longTextThresholdChars) {
      return this.checkAliyun(command, config, text);
    }

    return this.llmChecker.check(command, config, text);
  }

  async testUserInput(command: ContentSafetyCheckCommand): Promise<AdminContentSafetyTestDocument> {
    const startedAt = Date.now();
    try {
      const result = await this.assertUserInputAllowed(command);
      return {
        allowed: true,
        blocked: false,
        layer: result.layer,
        code: "OK",
        message: result.layer === "failed_open" ? "审核服务未完成，已按 fail-open 策略放行" : "允许发送",
        textLength: command.text.length,
        elapsedMs: Date.now() - startedAt,
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
          elapsedMs: Date.now() - startedAt,
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

    const normalizedText = normalizeSafetyText(text);
    const matched = rules
      .filter((rule) => rule.enabled)
      .find((rule) => normalizedText.includes(normalizeSafetyText(rule.term)));
    if (!matched) {
      return { blocked: false };
    }

    return {
      blocked: true,
      keywordId: matched.id,
      category: matched.category,
    };
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
      await this.records.recordCheck(command, config, {
        method: "failed_open",
        decision: "failed_open",
        text,
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
      await this.records.recordCheck(command, config, {
        method: "failed_open",
        decision: "failed_open",
        text,
        failureReason: "aliyun_credentials_missing",
        failureDetail: "Aliyun content safety is enabled, but one or more PASSWORD references resolved to an empty value.",
        metadata: {
          accessKeyIdPasswordKey: config.aliyun.accessKeyIdPasswordKey,
          accessKeySecretPasswordKey: config.aliyun.accessKeySecretPasswordKey,
          hasAccessKeyId: Boolean(accessKeyId),
          hasAccessKeySecret: Boolean(accessKeySecret),
        },
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
        await this.records.recordCheck(command, config, {
          method: "aliyun",
          decision: "block",
          text,
          blockedText: text,
          category: result.category,
          latencyMs: Date.now() - startedAt,
          provider: "aliyun_content_safety",
          failureReason: undefined,
          metadata: {
            providerRequestId: result.providerRequestId,
            endpoint: config.aliyun.endpoint,
            region: config.aliyun.region,
            service: config.aliyun.service,
          },
        });
        this.throwSensitive("aliyun", result.category);
      }
      await this.records.recordCheck(command, config, {
        method: "aliyun",
        decision: "pass",
        text,
        category: result.category,
        latencyMs: Date.now() - startedAt,
        provider: "aliyun_content_safety",
        metadata: {
          providerRequestId: result.providerRequestId,
          endpoint: config.aliyun.endpoint,
          region: config.aliyun.region,
          service: config.aliyun.service,
        },
      });
      return { allowed: true, layer: "aliyun" };
    } catch (error) {
      if (error instanceof ApplicationError && error.code === "AI_INPUT_CONTENT_SENSITIVE") {
        throw error;
      }
      const failure = describeContentSafetyFailure(error);
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
      await this.records.recordCheck(command, config, {
        method: "failed_open",
        decision: "failed_open",
        text,
        latencyMs: Date.now() - startedAt,
        provider: "aliyun_content_safety",
        failureReason: failure.reason,
        failureDetail: failure.detail,
        metadata: {
          endpoint: config.aliyun.endpoint,
          region: config.aliyun.region,
          service: config.aliyun.service,
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

  async listBlockRecords(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyBlockRecordsDocument> {
    return this.records.listBlockRecords(filter);
  }

  async getStats(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyStatsDocument> {
    return this.records.getStats(filter);
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
      inputHash: hashContentSafetyText(command.text),
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
