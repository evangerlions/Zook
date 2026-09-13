import type { LlmObservabilityStore } from "../infrastructure/database/llm-observability-store.ts";
import { createHash } from "node:crypto";
import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LlmRouteCircuitBreakerService } from "./llm-route-circuit-breaker.service.ts";
import { toDateKey } from "../shared/utils.ts";

const SCOPE = "llm-email-alert";
const HOURLY_DEDUPE_TTL_SECONDS = 3 * 24 * 60 * 60;
const SUCCESS_RATE_THRESHOLD = 90;
const MINIMUM_REQUEST_COUNT = 20;

interface AlertEmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface LlmEmailAlertServiceOptions {
  environment?: NodeJS.ProcessEnv;
  sendMail?: (message: AlertEmailMessage) => Promise<void>;
}

export class LlmEmailAlertService {
  private smtpMissingLogged = false;

  constructor(
    private readonly observabilityStore: LlmObservabilityStore,
    private readonly kvManager: KVManager,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly circuitBreaker: LlmRouteCircuitBreakerService,
    private readonly logger: StructuredLogger,
    private readonly options: LlmEmailAlertServiceOptions = {},
  ) {}

  async runDueAlerts(now = new Date()): Promise<{ hourly: number; circuits: number }> {
    let config: Awaited<ReturnType<CommonLlmConfigService["getRuntimeConfig"]>>;
    try {
      config = await this.commonLlmConfigService.getRuntimeConfig();
    } catch (error) {
      this.logger.warn("LLM email alert configuration lookup failed", {
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return { hourly: 0, circuits: 0 };
    }
    if (config?.emailAlerts?.llmEnabled === false) {
      return { hourly: 0, circuits: 0 };
    }
    const hourly = await this.runBestEffort("hourly", () => this.sendHourlySuccessRateAlert(now));
    const circuits = await this.runBestEffort("circuit", () => this.sendCircuitAlerts(config));
    return { hourly, circuits };
  }

  async sendAiNovelFeedbackAlert(input: {
    userId: string;
    feedbackId: string;
    message: string;
    createdAt: string;
  }): Promise<void> {
    const config = await this.commonLlmConfigService.getRuntimeConfig();
    if (config?.emailAlerts?.aiNovelFeedbackEnabled === false) return;
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

  private async sendCircuitAlerts(
    config: Awaited<ReturnType<CommonLlmConfigService["getRuntimeConfig"]>>,
  ): Promise<number> {
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
    const smtp = this.getSmtpConfig();
    if (!smtp) return false;
    const claimed = await this.kvManager.setStringIfAbsent(SCOPE, key, "1", ttlSeconds);
    if (!claimed) return false;
    try {
      await this.sendMail(smtp, {
        from: smtp.username,
        to: smtp.recipient,
        subject: `[Zook Alert] ${summary}`,
        text: `${details}\n\n${text}`,
        html: `<h2>${escapeHtml(summary)}</h2><p>${escapeHtml(details)}</p><pre>${escapeHtml(text)}</pre>`,
      });
      return true;
    } catch (error) {
      await this.kvManager.delete(SCOPE, key);
      this.logger.warn("failed to deliver Zook alert email", {
        alertKey: key,
        errorCode: error instanceof Error ? error.name : "unknown",
      });
      return false;
    }
  }

  private getSmtpConfig(): { username: string; password: string; recipient: string } | undefined {
    const environment = this.options.environment ?? process.env;
    const username = environment.EMAIL_USERNAME?.trim();
    const password = environment.EMAIL_PASSWORD?.trim();
    const recipient = environment.EMAIL_TO_ADDRESS?.trim();
    if (username && password && recipient) return { username, password, recipient };
    if (!this.smtpMissingLogged) {
      this.smtpMissingLogged = true;
      this.logger.warn("Zook alert email is disabled because SMTP environment is incomplete", {
        hasUsername: Boolean(username),
        hasPassword: Boolean(password),
        hasRecipient: Boolean(recipient),
      });
    }
    return undefined;
  }

  private async sendMail(
    smtp: { username: string; password: string },
    message: AlertEmailMessage,
  ): Promise<void> {
    if (this.options.sendMail) return await this.options.sendMail(message);
    const transporter = createTransport({
      host: "smtp.163.com",
      port: 465,
      secure: true,
      requireTLS: true,
      auth: {
        user: smtp.username,
        pass: smtp.password,
      },
    } satisfies SMTPTransport.Options);
    await transporter.sendMail(message);
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    "\"": "&quot;",
  })[character] ?? character);
}
