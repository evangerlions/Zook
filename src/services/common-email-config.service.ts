import { AppConfigService } from "./app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { maskSensitiveFields, type SensitiveFieldRules } from "../shared/utils.ts";
import type {
  AdminAppSummary,
  AdminEmailServiceDocument,
  EmailServiceConfig,
  EmailSenderConfig,
  EmailServiceTemplateConfig,
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
const DEFAULT_EMAIL_REGION: TencentSesRegion = "ap-guangzhou";
const DEFAULT_TEMPLATE_LOCALE = "zh-CN";
const EMAIL_SERVICE_SENSITIVE_FIELDS: SensitiveFieldRules<EmailServiceConfig> = {
  secretId: { visibleChars: 4 },
  secretKey: { visibleChars: 4 },
};

export class CommonEmailConfigService {
  constructor(private readonly appConfigService: AppConfigService) {}

  getDocument(): AdminEmailServiceDocument {
    const config = this.getStoredConfig();
    return this.toDocument(this.maskSensitiveConfig(config));
  }

  async updateConfig(input: unknown): Promise<AdminEmailServiceDocument> {
    const existingConfig = this.getStoredConfig();
    const normalized = this.validateInput(input, existingConfig);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      EMAIL_SERVICE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      "common-email-service-update",
    );
    return this.getDocument();
  }

  getRuntimeConfig(
    locale = DEFAULT_TEMPLATE_LOCALE,
    senderId = "default",
  ): {
    config: EmailServiceConfig;
    resolvedRegion: TencentSesRegion;
    sender: EmailSenderConfig;
    template: EmailServiceTemplateConfig;
  } {
    const config = this.getStoredConfig();

    this.assertRuntimeConfig(config);

    return {
      config,
      resolvedRegion: DEFAULT_EMAIL_REGION,
      sender: this.resolveSender(config.senders, senderId),
      template: this.resolveTemplate(config.templates, locale),
    };
  }

  private getUpdatedAt(): string | undefined {
    return this.appConfigService.getRecord(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY)?.updatedAt;
  }

  private getStoredConfig(): EmailServiceConfig {
    const stored = this.appConfigService.getValue(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  private toDocument(config: EmailServiceConfig): AdminEmailServiceDocument {
    return {
      app: COMMON_APP_SUMMARY,
      configKey: EMAIL_SERVICE_CONFIG_KEY,
      config,
      resolvedRegion: DEFAULT_EMAIL_REGION,
      updatedAt: this.getUpdatedAt(),
    };
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

  private validateInput(input: unknown, existingConfig?: EmailServiceConfig): EmailServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const senders = this.normalizeSenders(source.senders);
    const templates = this.normalizeTemplates(source.templates);

    const config: EmailServiceConfig = {
      enabled: Boolean(source.enabled),
      secretId: this.resolveSensitiveField(source.secretId, existingConfig?.secretId),
      secretKey: this.resolveSensitiveField(source.secretKey, existingConfig?.secretKey),
      senders,
      templates,
    };

    if (!config.enabled) {
      return config;
    }

    if (!config.secretId || !config.secretKey) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "SecretId and SecretKey are required.");
    }

    if (!config.senders.length) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "At least one sender is required.");
    }

    if (!config.templates.length) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "At least one email template is required.");
    }

    return config;
  }

  private createDefaultConfig(): EmailServiceConfig {
    return {
      enabled: false,
      secretId: "",
      secretKey: "",
      senders: [],
      templates: [],
    };
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private optionalNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private normalizeSenders(value: unknown): EmailSenderConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Each email sender must be a JSON object.");
      }

      const source = item as Record<string, unknown>;
      const id = this.optionalString(source.id);
      const address = this.optionalString(source.address);

      if (!id) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender ID is required.");
      }

      if (!address) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender address is required.");
      }

      return {
        id,
        address,
      } satisfies EmailSenderConfig;
    });

    const senderSet = new Set<string>();
    for (const item of items) {
      if (senderSet.has(item.id)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate sender ID is not allowed: ${item.id}`);
      }
      senderSet.add(item.id);
    }

    return items;
  }

  private normalizeTemplates(value: unknown): EmailServiceTemplateConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Each email template must be a JSON object.");
      }

      const source = item as Record<string, unknown>;
      const locale = this.normalizeLocale(source.locale);
      const templateId = this.optionalNumber(source.templateId);
      const name = this.optionalString(source.name);

      if (!locale) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template locale is required.");
      }

      if (!name) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template name is required.");
      }

      if (!templateId || templateId <= 0) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template ID must be a positive number.");
      }

      return {
        locale,
        templateId,
        name,
      } satisfies EmailServiceTemplateConfig;
    });

    const localeSet = new Set<string>();
    for (const item of items) {
      if (localeSet.has(item.locale)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate template locale is not allowed: ${item.locale}`);
      }
      localeSet.add(item.locale);
    }

    return items;
  }

  private normalizeLocale(value: unknown): string {
    const normalized = this.optionalString(value);
    if (!normalized) {
      return "";
    }

    if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(normalized)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template locale must be a valid BCP 47 style language tag.");
    }

    const segments = normalized.split("-");
    return segments
      .map((segment, index) => {
        if (index === 0) {
          return segment.toLowerCase();
        }
        if (segment.length === 2) {
          return segment.toUpperCase();
        }
        return segment;
      })
      .join("-");
  }

  private assertRuntimeConfig(config: EmailServiceConfig): void {
    if (!config.enabled) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not enabled.");
    }

    if (!config.secretId || !config.secretKey || !config.senders.length || !config.templates.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not fully configured.");
    }
  }

  private resolveSender(senders: EmailSenderConfig[], senderId: string): EmailSenderConfig {
    if (!senders.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service sender is not configured.");
    }

    const normalizedSenderId = this.optionalString(senderId) || "default";
    const sender = senders.find((item) => item.id === normalizedSenderId);
    if (sender) {
      return sender;
    }

    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      `Email sender is not configured: ${normalizedSenderId}`,
    );
  }

  private resolveTemplate(templates: EmailServiceTemplateConfig[], locale: string): EmailServiceTemplateConfig {
    if (!templates.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service template is not configured.");
    }

    const normalizedLocale = this.normalizeLocale(locale || DEFAULT_TEMPLATE_LOCALE);
    const exactMatch = templates.find((item) => item.locale === normalizedLocale);
    if (exactMatch) {
      return exactMatch;
    }

    const languageOnly = normalizedLocale.split("-")[0];
    const fallbackMatch = templates.find((item) => item.locale === languageOnly);
    if (fallbackMatch) {
      return fallbackMatch;
    }

    return templates[0];
  }

  private resolveSensitiveField(input: unknown, existingValue?: string, visibleChars = 4): string {
    const normalized = this.optionalString(input);
    const existing = existingValue?.trim() ?? "";

    if (!normalized) {
      return "";
    }

    if (!existing) {
      return normalized;
    }

    const prefix = existing.slice(0, Math.min(visibleChars, existing.length));
    if (normalized.endsWith("****") && normalized.startsWith(prefix)) {
      return existing;
    }

    return normalized;
  }

  private maskSensitiveConfig(config: EmailServiceConfig): EmailServiceConfig {
    return maskSensitiveFields(config, EMAIL_SERVICE_SENSITIVE_FIELDS);
  }
}
