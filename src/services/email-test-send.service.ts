import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { ApplicationError, badRequest, tooManyRequests } from "../shared/errors.ts";
import type { AdminEmailTestSendCommand, AdminEmailTestSendDocument } from "../shared/types.ts";
import { CommonEmailConfigService } from "./common-email-config.service.ts";
import type { VerificationEmailSender } from "./tencent-ses-registration-email.service.ts";

const EMAIL_TEST_SCOPE = "admin-email-test-send";
const EMAIL_TEST_COOLDOWN_KEY = "cooldown";
const DEFAULT_EMAIL_TEST_COOLDOWN_MS = 20_000;

export interface EmailTestSendServiceOptions {
  now?: () => Date;
  cooldownMs?: number;
}

export class EmailTestSendService {
  constructor(
    private readonly commonEmailConfigService: CommonEmailConfigService,
    private readonly kvManager: KVManager,
    private readonly emailSender: VerificationEmailSender,
    private readonly options: EmailTestSendServiceOptions = {},
  ) {}

  async run(command: AdminEmailTestSendCommand): Promise<AdminEmailTestSendDocument> {
    await this.assertCooldown();

    const normalized = this.normalizeCommand(command);
    const runtime = await this.commonEmailConfigService.getRuntimeConfigByTemplateId(
      normalized.templateId,
      normalized.region,
    );

    const providerResult = await this.emailSender.sendTemplateEmail({
      email: normalized.recipientEmail,
      region: normalized.region,
      fromEmailAddress: runtime.sender.address,
      subject: runtime.template.subject,
      templateId: runtime.template.templateId,
      templateData: {
        appName: normalized.appName,
        expireMinutes: normalized.expireMinutes,
        code: normalized.code,
      },
    });

    return {
      executedAt: this.getNow().toISOString(),
      cooldownSeconds: Math.ceil(this.getCooldownMs() / 1000),
      recipientEmail: normalized.recipientEmail,
      sender: {
        id: runtime.sender.id,
        address: runtime.sender.address,
        region: runtime.sender.region,
      },
      template: {
        locale: runtime.template.locale,
        templateId: runtime.template.templateId,
        name: runtime.template.name,
        subject: runtime.template.subject,
      },
      templateData: {
        appName: normalized.appName,
        expireMinutes: normalized.expireMinutes,
        code: normalized.code,
      },
      provider: providerResult.provider,
      providerRequestId: providerResult.requestId,
      providerMessageId: providerResult.messageId,
    };
  }

  private async assertCooldown(): Promise<void> {
    const now = this.getNow().getTime();
    const previous = await this.kvManager.getString(EMAIL_TEST_SCOPE, EMAIL_TEST_COOLDOWN_KEY);
    const previousMs = previous ? Number(previous) : 0;
    const cooldownMs = this.getCooldownMs();

    if (Number.isFinite(previousMs) && previousMs > 0 && now - previousMs < cooldownMs) {
      const retryAfterMs = cooldownMs - (now - previousMs);
      tooManyRequests(
        "ADMIN_RATE_LIMITED",
        `测试邮件 20 秒内只能发送一次，请在 ${Math.ceil(retryAfterMs / 1000)} 秒后重试。`,
        {
          retryAfterMs,
        },
      );
    }

    await this.kvManager.setString(EMAIL_TEST_SCOPE, EMAIL_TEST_COOLDOWN_KEY, String(now));
  }

  private normalizeCommand(command: AdminEmailTestSendCommand): AdminEmailTestSendCommand {
    const recipientEmail = command.recipientEmail.trim().toLowerCase();
    const appName = command.appName.trim();
    const code = command.code.trim();
    const expireMinutes = Number(command.expireMinutes);

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
      badRequest("REQ_INVALID_BODY", "recipientEmail must be a valid email address.");
    }

    if (!appName) {
      badRequest("REQ_INVALID_BODY", "appName is required.");
    }

    if (!code) {
      badRequest("REQ_INVALID_BODY", "code is required.");
    }

    if (!Number.isFinite(expireMinutes) || expireMinutes <= 0 || expireMinutes > 120) {
      badRequest("REQ_INVALID_BODY", "expireMinutes must be a positive number not greater than 120.");
    }

    if (!Number.isInteger(command.templateId) || command.templateId <= 0) {
      badRequest("REQ_INVALID_BODY", "templateId must be a positive integer.");
    }

    return {
      recipientEmail,
      region: command.region,
      templateId: command.templateId,
      appName,
      code,
      expireMinutes,
    };
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date();
  }

  private getCooldownMs(): number {
    return this.options.cooldownMs ?? DEFAULT_EMAIL_TEST_COOLDOWN_MS;
  }
}
