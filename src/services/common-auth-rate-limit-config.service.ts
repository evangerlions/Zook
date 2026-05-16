import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminAuthRateLimitDocument,
  AuthRateLimitConfig,
} from "../shared/types.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";

const COMMON_APP_ID = "common";
export const AUTH_RATE_LIMIT_CONFIG_KEY = "common.auth_rate_limits";

const COMMON_APP_SUMMARY: AdminAppSummary = {
  appId: COMMON_APP_ID,
  appCode: COMMON_APP_ID,
  appName: "服务端配置",
  appNameI18n: {
    "zh-CN": "服务端配置",
    "en-US": "Server Config",
  },
  status: "ACTIVE",
  canDelete: false,
  logSecret: {
    keyId: "common",
    secretMasked: "",
    updatedAt: "",
  },
};

const DEFAULT_AUTH_RATE_LIMIT_CONFIG: AuthRateLimitConfig = {
  resendCooldownSeconds: 60,
  verificationCodeTtlSeconds: 600,
  sendCodeWindowSeconds: 600,
  sendCodeWindowLimit: 3,
  verifyWindowSeconds: 600,
  verifyWindowLimit: 10,
  accountDailyLimit: 10,
  ipHourlyLimit: 20,
  maxFailedCodeAttempts: 10,
};

export class CommonAuthRateLimitConfigService {
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(revision?: number): Promise<AdminAuthRateLimitDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY, revision)
      : await this.getCurrentConfigRecord();

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Auth rate limit revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : this.createDefaultConfig();
    return {
      app: COMMON_APP_SUMMARY,
      configKey: AUTH_RATE_LIMIT_CONFIG_KEY,
      config,
      updatedAt: record?.createdAt ?? await this.getUpdatedAt(),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminAuthRateLimitDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      AUTH_RATE_LIMIT_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-auth-rate-limits-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<AdminAuthRateLimitDocument> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Auth rate limit revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      AUTH_RATE_LIMIT_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async getRuntimeConfig(): Promise<AuthRateLimitConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  private async getUpdatedAt(): Promise<string | undefined> {
    return this.appConfigService.getUpdatedAt(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY);
  }

  private async getCurrentConfigRecord() {
    return this.appConfigService.getLatestRevision(COMMON_APP_ID, AUTH_RATE_LIMIT_CONFIG_KEY);
  }

  private parseConfig(raw: string): AuthRateLimitConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored auth rate limit config is invalid.");
    }

    return this.validateInput(parsed);
  }

  private validateInput(input: unknown): AuthRateLimitConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "Auth rate limit config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const config: AuthRateLimitConfig = {
      resendCooldownSeconds: this.requirePositiveInteger(source.resendCooldownSeconds, "resendCooldownSeconds"),
      verificationCodeTtlSeconds: this.requirePositiveInteger(source.verificationCodeTtlSeconds, "verificationCodeTtlSeconds"),
      sendCodeWindowSeconds: this.requirePositiveInteger(source.sendCodeWindowSeconds, "sendCodeWindowSeconds"),
      sendCodeWindowLimit: this.requirePositiveInteger(source.sendCodeWindowLimit, "sendCodeWindowLimit"),
      verifyWindowSeconds: this.requirePositiveInteger(source.verifyWindowSeconds, "verifyWindowSeconds"),
      verifyWindowLimit: this.requirePositiveInteger(source.verifyWindowLimit, "verifyWindowLimit"),
      accountDailyLimit: this.requirePositiveInteger(source.accountDailyLimit, "accountDailyLimit"),
      ipHourlyLimit: this.requirePositiveInteger(source.ipHourlyLimit, "ipHourlyLimit"),
      maxFailedCodeAttempts: this.requirePositiveInteger(source.maxFailedCodeAttempts, "maxFailedCodeAttempts"),
    };

    if (config.verifyWindowLimit < config.maxFailedCodeAttempts) {
      badRequest(
        "REQ_INVALID_BODY",
        "verifyWindowLimit must be greater than or equal to maxFailedCodeAttempts.",
      );
    }

    return config;
  }

  private createDefaultConfig(): AuthRateLimitConfig {
    return {
      ...DEFAULT_AUTH_RATE_LIMIT_CONFIG,
    };
  }

  private requirePositiveInteger(value: unknown, field: keyof AuthRateLimitConfig): number {
    if (!Number.isInteger(value) || Number(value) <= 0) {
      badRequest("REQ_INVALID_BODY", `${field} must be a positive integer.`);
    }
    return Number(value);
  }
}
