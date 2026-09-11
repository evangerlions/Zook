import type { LlmObservabilityStore } from "../infrastructure/database/llm-observability-store.ts";
import { createHash } from "node:crypto";
import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { DEFAULT_EMAIL_REGION } from "./common-email-config-normalizer.ts";
import type { CommonEmailConfigService } from "./common-email-config.service.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmRouteCircuitBreakerService } from "./llm-route-circuit-breaker.service.ts";
import type { RegistrationEmailSender } from "./tencent-ses-registration-email.service.ts";
import { toDateKey } from "../shared/utils.ts";

const SCOPE = "llm-email-alert";
const ALERT_TEMPLATE_NAME = "llm-alert";
const HOURLY_DEDUPE_TTL_SECONDS = 3 * 24 * 60 * 60;
const SUCCESS_RATE_THRESHOLD = 90;
const MINIMUM_REQUEST_COUNT = 20;

export class LlmEmailAlertService {
  constructor(
    private readonly observabilityStore: LlmObservabilityStore,
    private readonly kvManager: KVManager,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly circuitBreaker: LlmRouteCircuitBreakerService,
    private readonly emailSender: RegistrationEmailSender,
    private readonly logger: StructuredLogger,
  ) {}

  async runDueAlerts(now = new Date()): Promise<{ hourly: number; circuits: number }> {
    const hourly = await this.runBestEffort("hourly", () => this.sendHourlySuccessRateAlert(now));
    const circuits = await this.runBestEffort("circuit", () => this.sendCircuitAlerts());
    return { hourly, circuits };
  }

  async sendAiNovelFeedbackAlert(input: {
    userId: string;
    feedbackId: string;
    message: string;
    createdAt: string;
  }): Promise<void> {
    await this.runBestEffort("ainovel_feedback", async () => {
      const day = toDateKey(input.createdAt);
      return await this.sendOnce(
        `ainovel-feedback:${hashValue(input.userId)}:${day}`,
        2 * 24 * 60 * 60,
        "AINovel feedback received",
        `Feedback ${input.feedbackId} from user ${hashValue(input.userId).slice(0, 12)}.`,
        input.message,
      ) ? 1 : 0;
    });
  }

  private async sendHourlySuccessRateAlert(now: Date): Promise<number> {
    const hourEnd = new Date(now);
    hourEnd.setUTCMinutes(0, 0, 0);
    const hourStart = new Date(hourEnd.getTime() - 60 * 60 * 1000);
    const result = await this.observabilityStore.queryMetrics({
      occurredAtFrom: hourStart.toISOString(),
      occurredAtTo: hourEnd.toISOString(),
      granularity: "hour",
    });
    const summary = result.summary;
    const reliabilityCount = summary.successCount + summary.failureCount + summary.timeoutCount;
    const successRate = reliabilityCount ? (summary.successCount / reliabilityCount) * 100 : 100;
    if (summary.requestCount <= MINIMUM_REQUEST_COUNT || successRate >= SUCCESS_RATE_THRESHOLD) return 0;
    return await this.sendOnce(
      `hourly:${hourStart.toISOString()}`,
      HOURLY_DEDUPE_TTL_SECONDS,
      "LLM hourly success rate below threshold",
      `Success rate ${successRate.toFixed(1)}% for ${summary.requestCount} upstream calls in the completed hour.`,
      `Window: ${hourStart.toISOString()} to ${hourEnd.toISOString()}\nSuccess: ${summary.successCount}\nFailure: ${summary.failureCount}\nTimeout: ${summary.timeoutCount}`,
    ) ? 1 : 0;
  }

  private async sendCircuitAlerts(): Promise<number> {
    const config = await this.commonLlmConfigService.getRuntimeConfig();
    if (!config?.enabled || !config.routeCircuitBreaker?.enabled) return 0;
    let sent = 0;
    for (const model of config.models) {
      if (model.kind !== "chat") continue;
      for (const route of model.routes) {
        const state = await this.circuitBreaker.getRuntimeStatus({
          modelKey: model.key,
          provider: route.provider,
          providerModel: route.providerModel,
          operation: "chat",
        }, true);
        if (state.state !== "open") continue;
        const key = `circuit:${model.key}:${route.provider}:${route.providerModel}:${state.openedAt ?? "active"}`;
        const delivered = await this.sendOnce(
          key,
          undefined,
          "LLM route circuit opened",
          `${model.key} via ${route.provider} / ${route.providerModel} is circuit-open.`,
          `Opened: ${state.openedAt ?? "unknown"}\nFailures: ${state.failureCount}\nDistinct users: ${state.distinctUserCount}\nNext recovery: ${state.nextRecoveryAt ?? "unknown"}`,
        );
        if (delivered) sent += 1;
      }
    }
    return sent;
  }

  private async sendOnce(
    key: string,
    ttlSeconds: number | undefined,
    summary: string,
    details: string,
    text: string,
  ): Promise<boolean> {
    const emailConfig = await this.commonEmailConfigService.getDocument();
    if (!emailConfig.config.enabled || !emailConfig.config.llmAlertRecipients.length) return false;
    try {
      const runtime = await this.commonEmailConfigService.getRuntimeConfig(
        "zh-CN",
        DEFAULT_EMAIL_REGION,
        ALERT_TEMPLATE_NAME,
      );
      const recipients = runtime.config.llmAlertRecipients;
      if (!recipients.length) return false;
      const results = await Promise.all(recipients.map((email) => this.sendToRecipient({
        key,
        ttlSeconds,
        email,
        region: runtime.resolvedRegion,
        fromEmailAddress: runtime.sender.address,
        templateId: runtime.template.templateId,
        summary,
        details,
        text,
      })));
      return results.some(Boolean);
    } catch (error) {
      this.logger.warn("failed to prepare LLM email alert", {
        alertKey: key,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  private async sendToRecipient(input: {
    key: string;
    ttlSeconds?: number;
    email: string;
    region: "ap-guangzhou" | "ap-hongkong";
    fromEmailAddress: string;
    templateId: number;
    summary: string;
    details: string;
    text: string;
  }): Promise<boolean> {
    const recipientKey = `${input.key}:recipient:${hashValue(input.email)}`;
    const claimed = await this.kvManager.setStringIfAbsent(SCOPE, recipientKey, "1", input.ttlSeconds);
    if (!claimed) return false;
    try {
      await this.emailSender.sendTemplateEmail({
        email: input.email,
        clientRegion: DEFAULT_EMAIL_REGION,
        region: input.region,
        fromEmailAddress: input.fromEmailAddress,
        subject: `[Zook LLM Alert] ${input.summary}`,
        templateId: input.templateId,
        templateData: {
          alertType: input.summary,
          summary: input.details,
          details: input.text,
        },
      });
      return true;
    } catch (error) {
      await this.kvManager.delete(SCOPE, recipientKey);
      this.logger.warn("failed to deliver LLM email alert", {
        alertKey: input.key,
        recipientHash: hashValue(input.email),
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  private async runBestEffort(label: string, task: () => Promise<number>): Promise<number> {
    try {
      return await task();
    } catch (error) {
      this.logger.warn("LLM email alert evaluation failed", {
        alertType: label,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return 0;
    }
  }
}

function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}
