import type { AdminAppSummary, ConfigRevisionMeta } from "./core";

export interface AuthRateLimitConfig {
  resendCooldownSeconds: number;
  verificationCodeTtlSeconds: number;
  sendCodeWindowSeconds: number;
  sendCodeWindowLimit: number;
  verifyWindowSeconds: number;
  verifyWindowLimit: number;
  accountDailyLimit: number;
  ipHourlyLimit: number;
  maxFailedCodeAttempts: number;
}

export interface AdminAuthRateLimitDocument {
  app: AdminAppSummary;
  configKey: string;
  config: AuthRateLimitConfig;
  updatedAt?: string;
  revision?: number;
  desc?: string;
  isLatest: boolean;
  revisions: ConfigRevisionMeta[];
}
