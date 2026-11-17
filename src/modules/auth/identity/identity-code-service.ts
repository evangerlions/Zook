import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { AppRegistryService } from "../../app-registry/app-registry.service.ts";
import type { RegistrationEmailSender } from "../../../services/tencent-ses-registration-email.service.ts";
import type { SmsVerificationSender } from "../../../services/tencent-sms-verification.service.ts";
import type { SmsVerificationRecordService } from "../../../services/sms-verification-record.service.ts";
import { badRequest } from "../../../shared/errors.ts";
import { sha256, timingSafeHexCompare } from "../../../shared/utils.ts";
import type { AuthVerificationLimiter } from "../auth-verification-limiter.ts";
import { prepareEmailCodeDelivery } from "../auth-email-delivery.ts";
import { prepareSmsCodeDelivery } from "../auth-sms-delivery.ts";
import type { IdentityChange } from "./auth-identity-models.ts";
import type { TencentSesRegion } from "../../../shared/types.ts";

export interface IdentityRequestContext {
  ipAddress: string;
  locale: string;
  emailRegion: TencentSesRegion;
}

export class IdentityCodeService {
  constructor(private readonly deps: {
    database: ApplicationDatabase; registry: AppRegistryService; limiter: AuthVerificationLimiter;
    emailSender: RegistrationEmailSender; smsSender: SmsVerificationSender;
    smsRecords: SmsVerificationRecordService; codeGenerator: () => string;
  }) {}

  async prepare(change: IdentityChange, challenge: NonNullable<IdentityChange["challenge"]>, context: IdentityRequestContext, now: Date) {
    const { limiter, registry, database } = this.deps;
    const rate = await limiter.getRuntimeConfig();
    const channel = challenge.method === "email_code" ? "email" : "sms";
    await limiter.consumeRegistrationCodeLimits(change.appId, challenge.subject, context.ipAddress, rate, now, channel);
    const app = await registry.getAppOrThrow(change.appId);
    const rawCode = this.deps.codeGenerator();
    if (!/^\d{6}$/.test(rawCode)) throw new Error("Identity code generator must return six digits");
    const common = { app, cacheKey: challenge.codeKey, rateLimit: rate, now };
    if (channel === "email") {
      return prepareEmailCodeDelivery({ ...common, email: challenge.subject,
        command: { appId: change.appId, email: challenge.subject, ipAddress: context.ipAddress, locale: context.locale, region: context.emailRegion } },
      { database, registry, sender: this.deps.emailSender, limiter }, rawCode);
    }
    return prepareSmsCodeDelivery({ ...common, phone: challenge.subject, ipAddress: context.ipAddress, scene: "identity-change", test: false },
      { database, limiter, sender: this.deps.smsSender, records: this.deps.smsRecords }, rawCode);
  }

  async verify(change: IdentityChange, challengeId: string, code: string, context: IdentityRequestContext, now: Date): Promise<void> {
    const challenge = change.challenge;
    if (!challenge || challenge.id !== challengeId) badRequest("AUTH_VERIFICATION_CODE_INVALID", "Verification code is invalid or expired.");
    const rate = await this.deps.limiter.getRuntimeConfig();
    await this.deps.limiter.consumeRegistrationLimits(change.appId, challenge.subject, context.ipAddress, rate, now,
      challenge.method === "email_code" ? "email" : "sms");
    const cached = await this.deps.limiter.getVerificationCodeEntry(challenge.codeKey, now);
    if (!cached || !timingSafeHexCompare(sha256(code), cached.codeHash)) {
      if (cached) await this.deps.limiter.recordFailedCodeAttempt(challenge.codeKey, cached, rate.maxFailedCodeAttempts, now);
      badRequest("AUTH_VERIFICATION_CODE_INVALID", "Verification code is invalid or expired.");
    }
  }

  async consume(change: IdentityChange, code?: string): Promise<void> {
    if (!change.challenge) return;
    await this.deps.limiter.deleteVerificationCodeEntry(change.challenge.codeKey);
    if (change.challenge.method === "sms_code" && code) await this.deps.smsRecords.markConsumed({
      appId: change.appId, scene: "identity-change", phone: change.challenge.subject, code,
    });
  }
}
