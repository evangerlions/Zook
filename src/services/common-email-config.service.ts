import { AppConfigService } from "./app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminEmailServiceDocument,
  EmailServiceConfig,
  TencentSesRegion,
} from "../shared/types.ts";

const COMMON_APP_ID = "common";
const EMAIL_SERVICE_CONFIG_KEY = "common.email_service";
const COMMON_APP_SUMMARY: AdminAppSummary = {
  appId: COMMON_APP_ID,
  appCode: COMMON_APP_ID,
  appName: "Common",
  status: "ACTIVE",
  canDelete: false,
};
const MAINLAND_TIMEZONES = new Set(["Asia/Shanghai", "Asia/Chongqing", "Asia/Harbin", "Asia/Urumqi"]);

export class CommonEmailConfigService {
  constructor(private readonly appConfigService: AppConfigService) {}

  getDocument(): AdminEmailServiceDocument {
    const stored = this.appConfigService.getValue(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    const config = stored ? this.parseConfig(stored) : this.createDefaultConfig();

    return {
      app: COMMON_APP_SUMMARY,
      configKey: EMAIL_SERVICE_CONFIG_KEY,
      config,
      resolvedRegion: this.resolveRegion(config),
      updatedAt: this.getUpdatedAt(),
    };
  }

  updateConfig(input: unknown): AdminEmailServiceDocument {
    const normalized = this.validateInput(input);
    this.appConfigService.setValue(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY, JSON.stringify(normalized, null, 2));
    return this.getDocument();
  }

  getRuntimeConfig(): { config: EmailServiceConfig; resolvedRegion: TencentSesRegion } {
    const document = this.getDocument();

    if (!document.config.enabled) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not enabled.");
    }

    if (
      !document.config.secretId ||
      !document.config.secretKey ||
      !document.config.fromEmailAddress ||
      !document.config.verification.subject ||
      !document.config.verification.templateId ||
      !document.config.verification.templateDataKey
    ) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not fully configured.");
    }

    return {
      config: document.config,
      resolvedRegion: document.resolvedRegion,
    };
  }

  resolveRegion(config: EmailServiceConfig): TencentSesRegion {
    if (config.regionMode === "manual" && config.manualRegion) {
      return config.manualRegion;
    }

    const hintedRegion = process.env.TENCENT_SES_REGION_HINT;
    if (hintedRegion === "ap-guangzhou" || hintedRegion === "ap-hongkong") {
      return hintedRegion;
    }

    const timeZone = process.env.TZ ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    if (MAINLAND_TIMEZONES.has(timeZone)) {
      return "ap-guangzhou";
    }

    return "ap-hongkong";
  }

  private getUpdatedAt(): string | undefined {
    return this.appConfigService.getRecord(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY)?.updatedAt;
  }

  private parseConfig(raw: string): EmailServiceConfig {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored email service config is invalid.");
    }

    return this.validateInput(parsed);
  }

  private validateInput(input: unknown): EmailServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const verification =
      source.verification && typeof source.verification === "object" && !Array.isArray(source.verification)
        ? (source.verification as Record<string, unknown>)
        : {};

    const config: EmailServiceConfig = {
      enabled: Boolean(source.enabled),
      provider: "tencent_ses",
      regionMode: source.regionMode === "manual" ? "manual" : "auto",
      manualRegion: source.manualRegion === "ap-hongkong" ? "ap-hongkong" : "ap-guangzhou",
      secretId: this.optionalString(source.secretId),
      secretKey: this.optionalString(source.secretKey),
      fromEmailAddress: this.optionalString(source.fromEmailAddress),
      replyToAddresses: this.optionalString(source.replyToAddresses),
      verification: {
        subject: this.optionalString(verification.subject),
        templateId: this.optionalNumber(verification.templateId),
        templateDataKey: this.optionalString(verification.templateDataKey) || "code",
        triggerType: verification.triggerType === 0 ? 0 : 1,
      },
    };

    if (config.regionMode === "manual" && !config.manualRegion) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "manualRegion is required when regionMode is manual.");
    }

    if (!config.enabled) {
      return config;
    }

    if (!config.secretId || !config.secretKey) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "SecretId and SecretKey are required.");
    }

    if (!config.fromEmailAddress) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "From email address is required.");
    }

    if (!config.verification.subject) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Verification email subject is required.");
    }

    if (!config.verification.templateId || config.verification.templateId <= 0) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Verification template ID must be a positive number.");
    }

    if (!config.verification.templateDataKey) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Verification template variable key is required.");
    }

    return config;
  }

  private createDefaultConfig(): EmailServiceConfig {
    return {
      enabled: false,
      provider: "tencent_ses",
      regionMode: "auto",
      manualRegion: "ap-guangzhou",
      secretId: "",
      secretKey: "",
      fromEmailAddress: "",
      replyToAddresses: "",
      verification: {
        subject: "",
        templateId: 0,
        templateDataKey: "code",
        triggerType: 1,
      },
    };
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private optionalNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
}
