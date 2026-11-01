import type { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import type { AppRegistryService } from "../app-registry/app-registry.service.ts";
import type { RegistrationEmailSender } from "../../services/tencent-ses-registration-email.service.ts";
import { VERIFICATION_EMAIL_TEMPLATE_NAME } from "../../services/common-email-config.service.ts";
import type { EmailLoginCodeCommand, PasswordEmailCodeCommand, RegisterEmailCodeCommand, RegisterEmailCodeResult } from "../../shared/types.ts";
import { tooManyRequests } from "../../shared/errors.ts";
import { sha256 } from "../../shared/utils.ts";
import type { AuthVerificationLimiter, AuthRateLimitRuntimeConfig } from "./auth-verification-limiter.ts";

/** Request-local delivery data survives only until the provider call finishes. */
export interface EmailCodeDeliveryInput {
  app: { id: string }; email: string; cacheKey: string;
  command: RegisterEmailCodeCommand | EmailLoginCodeCommand | PasswordEmailCodeCommand;
  rateLimit: AuthRateLimitRuntimeConfig; now: Date;
}

/** Reserves the code inside the caller's transaction and returns delivery work for outside it. */
export async function prepareEmailCodeDelivery(input: EmailCodeDeliveryInput, dependencies: {
  database: ApplicationDatabase; registry: AppRegistryService;
  sender: RegistrationEmailSender; limiter: AuthVerificationLimiter;
}, rawCode: string): Promise<() => Promise<RegisterEmailCodeResult>> {
  const { database, registry, sender, limiter } = dependencies;
  const previous = await limiter.getVerificationCodeEntry(input.cacheKey, input.now);
  if (previous && input.now.getTime() - new Date(previous.sentAt).getTime() < input.rateLimit.resendCooldownMs)
    tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
  const entry = { codeHash: sha256(rawCode), sentAt: input.now.toISOString(), failedAttempts: 0,
    expiresAt: new Date(input.now.getTime() + input.rateLimit.verificationCodeTtlMs).toISOString() };
  await limiter.setVerificationCodeEntry(input.cacheKey, entry, input.rateLimit.verificationCodeTtlMs, input.now);
  return async () => {
    try {
      await sender.sendVerificationCode({
        appName: registry.resolveLocalizedAppName(input.app, { locale: input.command.locale, region: input.command.region }),
        email: input.email, code: rawCode, locale: input.command.locale.trim() || "zh-CN", region: input.command.region,
        expireMinutes: Math.floor(input.rateLimit.verificationCodeTtlMs / 60_000), templateName: VERIFICATION_EMAIL_TEMPLATE_NAME,
      });
    } catch (error) {
      await database.withExclusiveSession(async () => {
        const current = await limiter.getVerificationCodeEntry(input.cacheKey, input.now);
        if (current?.codeHash === entry.codeHash && current.sentAt === entry.sentAt)
          await limiter.deleteVerificationCodeEntry(input.cacheKey);
      });
      throw error;
    }
    return { accepted: true, cooldownSeconds: Math.floor(input.rateLimit.resendCooldownMs / 1000),
      expiresInSeconds: Math.floor(input.rateLimit.verificationCodeTtlMs / 1000) };
  };
}
