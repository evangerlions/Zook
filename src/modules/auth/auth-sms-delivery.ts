import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { AppRecord, RegisterEmailCodeResult, SmsVerificationScene } from "../../shared/types.ts";
import type { SmsVerificationSender } from "../../services/tencent-sms-verification.service.ts";
import type { SmsVerificationRecordService } from "../../services/sms-verification-record.service.ts";
import { tooManyRequests } from "../../shared/errors.ts";
import { sha256 } from "../../shared/utils.ts";
import { buildSmsProviderFailure } from "./auth-sms-provider-failure.ts";
import type { AuthRateLimitRuntimeConfig, AuthVerificationLimiter } from "./auth-verification-limiter.ts";

export interface SmsCodeDeliveryInput {
  app: AppRecord; ipAddress?: string; phone: string; phoneNa?: string; cacheKey: string;
  scene: SmsVerificationScene; rateLimit: AuthRateLimitRuntimeConfig; now: Date; test: boolean;
}

/** Reserve within the caller transaction; invoke returned provider work outside it. */
export async function prepareSmsCodeDelivery(input: SmsCodeDeliveryInput, dependencies: {
  database: ApplicationDatabase; limiter: AuthVerificationLimiter;
  sender: SmsVerificationSender; records: SmsVerificationRecordService;
}, rawCode: string): Promise<() => Promise<RegisterEmailCodeResult>> {
  const { database, limiter, sender, records } = dependencies;
  const previous = await limiter.getVerificationCodeEntry(input.cacheKey, input.now);
  if (previous && input.now.getTime() - new Date(previous.sentAt).getTime() < input.rateLimit.resendCooldownMs)
    tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
  const entry = { codeHash: sha256(rawCode), sentAt: input.now.toISOString(), failedAttempts: 0,
    expiresAt: new Date(input.now.getTime() + input.rateLimit.verificationCodeTtlMs).toISOString() };
  await limiter.setVerificationCodeEntry(input.cacheKey, entry, input.rateLimit.verificationCodeTtlMs, input.now);
  const record = await records.recordIssued({ appId: input.app.id, scene: input.scene, phone: input.phone,
    phoneNa: input.phoneNa, code: rawCode, isTest: input.test, sentAt: entry.sentAt, expiresAt: entry.expiresAt });
  return async () => {
    if (!input.test) {
      try {
        const result = await sender.sendVerificationCode({ phoneNumber: input.phone, code: rawCode,
          expireMinutes: Math.floor(input.rateLimit.verificationCodeTtlMs / 60_000) });
        await records.markProviderAccepted(record.id, { providerRequestId: result.requestId, providerSerialNo: result.sendSerialNo });
      } catch (error) {
        await database.withExclusiveSession(async () => {
          const current = await limiter.getVerificationCodeEntry(input.cacheKey, input.now);
          if (current?.codeHash === entry.codeHash && current.sentAt === entry.sentAt) await limiter.deleteVerificationCodeEntry(input.cacheKey);
        });
        await records.markProviderFailed(record.id, buildSmsProviderFailure(error));
        throw error;
      }
    }
    return { accepted: true, cooldownSeconds: Math.floor(input.rateLimit.resendCooldownMs / 1000),
      expiresInSeconds: Math.floor(input.rateLimit.verificationCodeTtlMs / 1000) };
  };
}
