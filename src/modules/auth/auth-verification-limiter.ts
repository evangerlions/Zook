import { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import { tooManyRequests } from "../../shared/errors.ts";
import type { AuthRateLimitConfig } from "../../shared/types.ts";
import { sha256, toDateKey, toHourKey } from "../../shared/utils.ts";
import { CommonAuthRateLimitConfigService } from "../../services/common-auth-rate-limit-config.service.ts";

export interface EmailVerificationCacheEntry {
  codeHash: string;
  expiresAt: string;
  sentAt: string;
  failedAttempts: number;
}

export interface AuthRateLimitRuntimeConfig {
  resendCooldownMs: number;
  verificationCodeTtlMs: number;
  sendCodeWindowMs: number;
  sendCodeWindowLimit: number;
  verifyWindowMs: number;
  verifyWindowLimit: number;
  accountDailyLimit: number;
  ipHourlyLimit: number;
  maxFailedCodeAttempts: number;
}

export class AuthVerificationLimiter {
  private readonly verificationCodeScope = "auth.verification-codes";
  private readonly rateLimitScope = "auth.rate-limits";

  constructor(
    private readonly kvManager: KVManager,
    private readonly commonAuthRateLimitConfigService: CommonAuthRateLimitConfigService,
  ) {}

  async getRuntimeConfig(): Promise<AuthRateLimitRuntimeConfig> {
    const config =
      await this.commonAuthRateLimitConfigService.getRuntimeConfig();
    return this.toRuntimeConfig(config);
  }

  async consumeRegistrationCodeLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("email-code", appId, accountKey, ipAddress, channel),
      rateLimit.sendCodeWindowMs,
      rateLimit.sendCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildRegistrationDayRateKey(accountKey, now, channel),
      48 * 60 * 60,
      rateLimit.accountDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildRegistrationIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      rateLimit.ipHourlyLimit,
      now,
    );
  }

  async consumeRegistrationLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("complete", appId, accountKey, ipAddress, channel),
      rateLimit.verifyWindowMs,
      rateLimit.verifyWindowLimit,
      now,
    );
  }

  async consumeEmailLoginCodeLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("email-code", appId, accountKey, ipAddress, channel),
      rateLimit.sendCodeWindowMs,
      rateLimit.sendCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildEmailLoginDayRateKey(accountKey, now, channel),
      48 * 60 * 60,
      rateLimit.accountDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildEmailLoginIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      rateLimit.ipHourlyLimit,
      now,
    );
  }

  async consumeEmailLoginLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("complete", appId, accountKey, ipAddress, channel),
      rateLimit.verifyWindowMs,
      rateLimit.verifyWindowLimit,
      now,
    );
  }

  async consumePasswordCodeLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildPasswordResetComboRateKey("email-code", appId, accountKey, ipAddress, channel),
      rateLimit.sendCodeWindowMs,
      rateLimit.sendCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildPasswordResetDayRateKey(accountKey, now, channel),
      48 * 60 * 60,
      rateLimit.accountDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildPasswordResetIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      rateLimit.ipHourlyLimit,
      now,
    );
  }

  async consumePasswordResetLimits(
    appId: string,
    accountKey: string,
    ipAddress: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): Promise<void> {
    await this.consumeRollingWindow(
      this.buildPasswordResetComboRateKey("complete", appId, accountKey, ipAddress, channel),
      rateLimit.verifyWindowMs,
      rateLimit.verifyWindowLimit,
      now,
    );
  }

  buildRegistrationCodeKey(
    appId: string,
    accountKey: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:register:code:${appId}:${accountKey}`;
  }

  buildEmailLoginCodeKey(
    appId: string,
    accountKey: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:login:code:${appId}:${accountKey}`;
  }

  buildPasswordResetCodeKey(
    appId: string,
    accountKey: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:password-reset:code:${appId}:${accountKey}`;
  }

  async getVerificationCodeEntry(
    key: string,
    now = new Date(),
  ): Promise<EmailVerificationCacheEntry | undefined> {
    const entry = await this.kvManager.getJson<EmailVerificationCacheEntry>(
      this.verificationCodeScope,
      key,
    );
    if (!entry) {
      return undefined;
    }
    if (new Date(entry.expiresAt) <= now) {
      await this.deleteVerificationCodeEntry(key);
      return undefined;
    }
    return entry;
  }

  async setVerificationCodeEntry(
    key: string,
    entry: EmailVerificationCacheEntry,
    ttlMs: number,
    now = new Date(),
  ): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.ceil(
        Math.min(ttlMs, new Date(entry.expiresAt).getTime() - now.getTime()) /
          1000,
      ),
    );
    await this.kvManager.setJson(
      this.verificationCodeScope,
      key,
      entry,
      ttlSeconds,
    );
  }

  async deleteVerificationCodeEntry(key: string): Promise<void> {
    await this.kvManager.delete(this.verificationCodeScope, key);
  }

  async recordFailedCodeAttempt(
    cacheKey: string,
    cachedCode: EmailVerificationCacheEntry,
    maxFailedCodeAttempts: number,
    now = new Date(),
  ): Promise<void> {
    const nextFailedAttempts = cachedCode.failedAttempts + 1;
    if (nextFailedAttempts >= maxFailedCodeAttempts) {
      await this.deleteVerificationCodeEntry(cacheKey);
      return;
    }

    const remainingMs =
      new Date(cachedCode.expiresAt).getTime() - now.getTime();
    if (remainingMs <= 0) {
      await this.deleteVerificationCodeEntry(cacheKey);
      return;
    }

    await this.setVerificationCodeEntry(
      cacheKey,
      { ...cachedCode, failedAttempts: nextFailedAttempts },
      remainingMs,
      now,
    );
  }

  private async consumeRollingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now = new Date(),
  ): Promise<void> {
    const currentWindow = (
      (await this.kvManager.getJson<number[]>(this.rateLimitScope, key)) ?? []
    ).filter((timestamp) => now.getTime() - timestamp < windowMs);
    if (currentWindow.length >= limit) {
      tooManyRequests(
        "AUTH_RATE_LIMITED",
        "Request rate is too high. Please retry later.",
      );
    }
    currentWindow.push(now.getTime());
    await this.kvManager.setJson(
      this.rateLimitScope,
      key,
      currentWindow,
      Math.ceil(windowMs / 1000),
    );
  }

  private async consumeBucketCount(
    key: string,
    ttlSeconds: number,
    limit: number,
  ): Promise<void> {
    const current =
      (await this.kvManager.getJson<number>(this.rateLimitScope, key)) ?? 0;
    if (current >= limit) {
      tooManyRequests(
        "AUTH_RATE_LIMITED",
        "Request rate is too high. Please retry later.",
      );
    }
    await this.kvManager.setJson(
      this.rateLimitScope,
      key,
      current + 1,
      ttlSeconds,
    );
  }

  private toRuntimeConfig(
    config: AuthRateLimitConfig,
  ): AuthRateLimitRuntimeConfig {
    return {
      resendCooldownMs: config.resendCooldownSeconds * 1000,
      verificationCodeTtlMs: config.verificationCodeTtlSeconds * 1000,
      sendCodeWindowMs: config.sendCodeWindowSeconds * 1000,
      sendCodeWindowLimit: config.sendCodeWindowLimit,
      verifyWindowMs: config.verifyWindowSeconds * 1000,
      verifyWindowLimit: config.verifyWindowLimit,
      accountDailyLimit: config.accountDailyLimit,
      ipHourlyLimit: config.ipHourlyLimit,
      maxFailedCodeAttempts: config.maxFailedCodeAttempts,
    };
  }

  private buildRegistrationComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    accountKey: string,
    ipAddress: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:register:rate:${kind}:${appId}:${accountKey}:${ipAddress}`;
  }

  private buildRegistrationDayRateKey(
    accountKey: string,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:register:day:${toDateKey(now)}:${accountKey}`;
  }

  private buildRegistrationIpHourRateKey(
    ipAddress: string,
    now = new Date(),
  ): string {
    return `auth:register:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }

  private buildEmailLoginComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    accountKey: string,
    ipAddress: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:login:rate:${kind}:${appId}:${accountKey}:${ipAddress}`;
  }

  private buildEmailLoginDayRateKey(
    accountKey: string,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:login:day:${toDateKey(now)}:${accountKey}`;
  }

  private buildEmailLoginIpHourRateKey(
    ipAddress: string,
    now = new Date(),
  ): string {
    return `auth:email-login:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }

  private buildPasswordResetComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    accountKey: string,
    ipAddress: string,
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:password-reset:rate:${kind}:${appId}:${accountKey}:${ipAddress}`;
  }

  private buildPasswordResetDayRateKey(
    accountKey: string,
    now = new Date(),
    channel: "email" | "sms" = "email",
  ): string {
    return `auth:${channel}:password-reset:day:${toDateKey(now)}:${accountKey}`;
  }

  private buildPasswordResetIpHourRateKey(
    ipAddress: string,
    now = new Date(),
  ): string {
    return `auth:password-reset:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }
}
