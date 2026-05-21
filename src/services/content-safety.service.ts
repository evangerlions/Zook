import { createHash } from "node:crypto";
import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminContentSafetyBlockRecordItem,
  AdminContentSafetyBlockRecordsDocument,
  AdminContentSafetyStatsBucket,
  AdminContentSafetyStatsDocument,
  AdminContentSafetyTestDocument,
  ContentSafetyCheckMethod,
  ContentSafetyCheckRecord,
  ContentSafetyCheckSource,
  ContentSafetyConfig,
  ContentSafetyKeywordRule,
} from "../shared/types.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { CommonContentSafetyConfigService } from "./common-content-safety-config.service.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { LLMManager } from "./llm-manager.ts";
import { sendAliyunTextModerationRequest } from "./aliyun-content-safety-request.ts";
import { enumerateDateKeys, randomId, toDateKey } from "../shared/utils.ts";

export const AI_INPUT_CONTENT_SENSITIVE_MESSAGE = "这段内容暂时无法发送，请调整后再试。";

export interface ContentSafetyCheckCommand {
  appId: string;
  userId?: string;
  requestId?: string;
  taskType?: string;
  source?: ContentSafetyCheckSource;
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
type ContentSafetyStatsFilter = {
  dateFrom?: string;
  dateTo?: string;
  appId?: string;
  source?: string;
  method?: string;
  taskType?: string;
};
type ParsedLlmDecision =
  | { parsed: true; blocked: boolean; category?: string }
  | { parsed: false; reason: string; detail: string };

export class ContentSafetyService {
  constructor(
    private readonly configService: CommonContentSafetyConfigService,
    private readonly llmManager: LLMManager,
    private readonly passwordConfigService: CommonPasswordConfigService,
    private readonly database: ApplicationDatabase,
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
      await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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

    return this.checkLlm(command, config, text);
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
      await this.recordCheck(command, config, {
        method: "llm",
        decision: "pass",
        text,
        metadata: { disabled: true },
      });
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
      const latencyMs = Date.now() - startedAt;
      const llmDebug = {
        latencyMs,
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
          latencyMs,
          modelKey: result.modelKey,
          provider: result.provider,
          providerModel: result.providerModel,
          failureReason: decision.reason,
          failureDetail: decision.detail,
        });
        await this.recordCheck(command, config, {
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
      this.logDecision("info", "content safety llm checked user input", command, config, "llm", {
        decision: decision.blocked ? "block" : "pass",
        category: decision.category,
        latencyMs,
        modelKey: result.modelKey,
        provider: result.provider,
        providerModel: result.providerModel,
      });
      if (decision.blocked) {
        await this.recordCheck(command, config, {
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
        this.throwSensitive("llm", decision.category, llmDebug);
      }
      await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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
        await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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
      await this.recordCheck(command, config, {
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
    const range = normalizeStatsFilter(filter);
    const queryRange = toShanghaiIsoRange(range);
    await this.cleanupExpiredRecords();
    const records = await this.database.listContentSafetyCheckRecords({
      ...queryRange,
      appId: filter.appId?.trim() || undefined,
      source: parseSource(filter.source),
      method: parseMethod(filter.method),
      taskType: filter.taskType?.trim() || undefined,
      decision: "block",
      limit: 1000,
    });
    return {
      timezone: "Asia/Shanghai",
      items: records
        .filter((record) => record.text)
        .map((record) => ({
          id: record.id,
          appId: record.appId,
          userId: record.userId,
          requestId: record.requestId,
          taskType: record.taskType,
          source: record.source,
          method: record.method as AdminContentSafetyBlockRecordItem["method"],
          category: record.category,
          keywordId: record.keywordId,
          text: record.text as string,
          textLength: record.textLength,
          textHash: record.textHash,
          modelKey: record.modelKey,
          provider: record.provider,
          providerModel: record.providerModel,
          createdAt: record.createdAt,
        })),
    };
  }

  async getStats(filter: ContentSafetyStatsFilter): Promise<AdminContentSafetyStatsDocument> {
    const range = normalizeStatsFilter(filter);
    const queryRange = toShanghaiIsoRange(range);
    await this.cleanupExpiredRecords();
    const records = await this.database.listContentSafetyCheckRecords({
      ...queryRange,
      appId: filter.appId?.trim() || undefined,
      source: parseSource(filter.source),
      method: parseMethod(filter.method),
      taskType: filter.taskType?.trim() || undefined,
    });
    const total = records.length;
    const blocked = records.filter((record) => record.decision === "block").length;
    const failedOpen = records.filter((record) => record.decision === "failed_open").length;
    const passed = total - blocked - failedOpen;
    const latencyValues = records
      .map((record) => record.latencyMs)
      .filter((value): value is number => typeof value === "number");

    return {
      timezone: "Asia/Shanghai",
      summary: {
        total,
        passed,
        blocked,
        failedOpen,
        blockRate: ratio(blocked, total),
        failedOpenRate: ratio(failedOpen, total),
        avgLatencyMs: average(latencyValues),
        p95LatencyMs: percentile(latencyValues, 0.95),
      },
      daily: enumerateDateKeys(range.dateFrom, range.dateTo).map((date) => {
        const dailyRecords = records.filter((record) => toDateKey(record.createdAt) === date);
        return {
          date,
          total: dailyRecords.length,
          passed: dailyRecords.filter((record) => record.decision === "pass").length,
          blocked: dailyRecords.filter((record) => record.decision === "block").length,
          failedOpen: dailyRecords.filter((record) => record.decision === "failed_open").length,
        };
      }),
      byMethod: bucketRecords(records, (record) => record.method),
      bySource: bucketRecords(records, (record) => record.source),
      byApp: bucketRecords(records, (record) => record.appId),
      byTaskType: bucketRecords(records, (record) => record.taskType ?? "unknown"),
      byCategory: bucketRecords(records, (record) => record.category ?? "none"),
      byFailureReason: bucketRecords(records, (record) => record.failureReason ?? "none"),
      byLengthBucket: bucketRecords(records, (record) => lengthBucket(record.textLength)),
    };
  }

  private async recordCheck(
    command: ContentSafetyCheckCommand,
    config: ContentSafetyConfig,
    input: {
      method: ContentSafetyCheckMethod;
      decision: ContentSafetyCheckRecord["decision"];
      text: string;
      blockedText?: string;
      category?: string;
      keywordId?: string;
      latencyMs?: number;
      modelKey?: string;
      provider?: string;
      providerModel?: string;
      failureReason?: string;
      failureDetail?: string;
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    const createdAt = new Date().toISOString();
    await this.cleanupExpiredRecords();
    try {
      await this.database.insertContentSafetyCheckRecord({
        id: randomId("csf"),
        appId: command.appId,
        userId: command.userId,
        requestId: command.requestId,
        taskType: command.taskType,
        source: command.source ?? (command.taskType === "admin_content_safety_test" ? "admin_test" : "business"),
        method: input.method,
        decision: input.decision,
        category: input.category,
        keywordId: input.keywordId,
        text: input.blockedText,
        textLength: input.text.length,
        textHash: hashText(input.text),
        latencyMs: input.latencyMs,
        modelKey: input.modelKey,
        provider: input.provider,
        providerModel: input.providerModel,
        failureReason: input.failureReason,
        failureDetail: input.failureDetail,
        metadata: {
          thresholdChars: config.longTextThresholdChars,
          ...input.metadata,
        },
        createdAt,
      });
    } catch (error) {
      this.logger?.warn("content safety check record write failed", {
        appId: command.appId,
        requestId: command.requestId,
        taskType: command.taskType,
        decision: input.decision,
        method: input.method,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async cleanupExpiredRecords(): Promise<void> {
    try {
      await this.database.deleteContentSafetyCheckRecordsCreatedBefore(
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      );
    } catch (error) {
      this.logger?.warn("content safety check record cleanup failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
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

function normalizeStatsFilter(filter: ContentSafetyStatsFilter): { dateFrom: string; dateTo: string } {
  const today = toDateKey(new Date().toISOString());
  const defaultFrom = toDateKey(new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString());
  const dateFrom = normalizeDateKey(filter.dateFrom) ?? defaultFrom;
  const dateTo = normalizeDateKey(filter.dateTo) ?? today;
  return dateFrom <= dateTo
    ? { dateFrom, dateTo }
    : { dateFrom: dateTo, dateTo: dateFrom };
}

function normalizeDateKey(value?: string): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return undefined;
  }
  return value;
}

function toShanghaiIsoRange(range: { dateFrom: string; dateTo: string }): {
  createdAtFromIso: string;
  createdAtToIso: string;
} {
  return {
    createdAtFromIso: shanghaiDateStartToIso(range.dateFrom),
    createdAtToIso: shanghaiDateStartToIso(addDays(range.dateTo, 1)),
  };
}

function shanghaiDateStartToIso(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) - 8 * 60 * 60 * 1000).toISOString();
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function parseSource(value?: string): ContentSafetyCheckSource | undefined {
  return value === "business" || value === "admin_test" ? value : undefined;
}

function parseMethod(value?: string): ContentSafetyCheckMethod | undefined {
  return value === "disabled" ||
      value === "keyword" ||
      value === "llm" ||
      value === "aliyun" ||
      value === "failed_open"
    ? value
    : undefined;
}

function bucketRecords(
  records: ContentSafetyCheckRecord[],
  getKey: (record: ContentSafetyCheckRecord) => string,
): AdminContentSafetyStatsBucket[] {
  const groups = new Map<string, ContentSafetyCheckRecord[]>();
  records.forEach((record) => {
    const key = getKey(record);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  });
  return [...groups.entries()]
    .map(([key, items]) => {
      const latencies = items
        .map((item) => item.latencyMs)
        .filter((value): value is number => typeof value === "number");
      return {
        key,
        count: items.length,
        blocked: items.filter((item) => item.decision === "block").length,
        failedOpen: items.filter((item) => item.decision === "failed_open").length,
        avgLatencyMs: average(latencies),
        p95LatencyMs: percentile(latencies, 0.95),
      };
    })
    .sort((left, right) => right.count - left.count);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * percentileValue) - 1);
  return sorted[index];
}

function ratio(value: number, total: number): number {
  return total === 0 ? 0 : Number((value / total).toFixed(4));
}

function lengthBucket(length: number): string {
  if (length <= 100) {
    return "0-100";
  }
  if (length <= 500) {
    return "101-500";
  }
  if (length <= 2000) {
    return "501-2000";
  }
  return "2000+";
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
