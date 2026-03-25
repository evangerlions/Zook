import { AppConfigService } from "./app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
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
export const TENCENT_SECRET_ID_PASSWORD_KEY = "tencent.secret_id";
export const TENCENT_SECRET_KEY_PASSWORD_KEY = "tencent.secret_key";
export const TENCENT_SES_SECRET_ID_PASSWORD_KEY = TENCENT_SECRET_ID_PASSWORD_KEY;
export const TENCENT_SES_SECRET_KEY_PASSWORD_KEY = TENCENT_SECRET_KEY_PASSWORD_KEY;
const LEGACY_TENCENT_SES_SECRET_ID_PASSWORD_KEY = "tencent.ses.secret_id";
const LEGACY_TENCENT_SES_SECRET_KEY_PASSWORD_KEY = "tencent.ses.secret_key";
const COMMON_APP_SUMMARY: AdminAppSummary = {
  appId: COMMON_APP_ID,
  appCode: COMMON_APP_ID,
  appName: "服务端配置",
  status: "ACTIVE",
  canDelete: false,
};
const DEFAULT_EMAIL_REGION: TencentSesRegion = "ap-guangzhou";
const DEFAULT_TEMPLATE_LOCALE = "zh-CN";

export class CommonEmailConfigService {
  constructor(
    private readonly appConfigService: AppConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
  ) {}

  async getDocument(revision?: number): Promise<AdminEmailServiceDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Email service revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : this.getStoredConfig();
    return this.toDocument(config, {
      updatedAt: record?.createdAt ?? this.getUpdatedAt(),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    });
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminEmailServiceDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      EMAIL_SERVICE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-email-service-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number): Promise<AdminEmailServiceDocument> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Email service revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      EMAIL_SERVICE_CONFIG_KEY,
      revision,
      `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async getRuntimeConfig(
    locale = DEFAULT_TEMPLATE_LOCALE,
    region: TencentSesRegion = DEFAULT_EMAIL_REGION,
  ): Promise<{
    config: EmailServiceConfig;
    resolvedRegion: TencentSesRegion;
    secretId: string;
    secretKey: string;
    sender: EmailSenderConfig;
    template: EmailServiceTemplateConfig;
  }> {
    const config = this.getStoredConfig();

    this.assertRuntimeConfig(config);
    const credentials = await this.resolveCredentials();

    return {
      config,
      resolvedRegion: region,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      sender: this.resolveSender(config.senders, region),
      template: this.resolveTemplate(config.templates, locale),
    };
  }

  async getRuntimeConfigByTemplateId(
    templateId: number,
    region: TencentSesRegion = DEFAULT_EMAIL_REGION,
  ): Promise<{
    config: EmailServiceConfig;
    resolvedRegion: TencentSesRegion;
    secretId: string;
    secretKey: string;
    sender: EmailSenderConfig;
    template: EmailServiceTemplateConfig;
  }> {
    const config = this.getStoredConfig();

    this.assertRuntimeConfig(config);
    const credentials = await this.resolveCredentials();

    return {
      config,
      resolvedRegion: region,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      sender: this.resolveSender(config.senders, region),
      template: this.resolveTemplateById(config.templates, templateId),
    };
  }

  private getUpdatedAt(): string | undefined {
    return this.appConfigService.getRecord(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY)?.updatedAt;
  }

  private getStoredConfig(): EmailServiceConfig {
    const stored = this.appConfigService.getValue(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  private toDocument(
    config: EmailServiceConfig,
    options: {
      updatedAt?: string;
      revision?: number;
      desc?: string;
      isLatest: boolean;
      revisions: AdminEmailServiceDocument["revisions"];
    },
  ): AdminEmailServiceDocument {
    return {
      app: COMMON_APP_SUMMARY,
      configKey: EMAIL_SERVICE_CONFIG_KEY,
      config,
      resolvedRegion: DEFAULT_EMAIL_REGION,
      updatedAt: options.updatedAt,
      revision: options.revision,
      desc: options.desc,
      isLatest: options.isLatest,
      revisions: options.revisions,
    };
  }

  private parseConfig(raw: string): EmailServiceConfig {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored email service config is invalid.");
    }

    return this.validateInput(parsed, true);
  }

  private validateInput(input: unknown, allowLegacyFallback = false): EmailServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const senders = this.normalizeSenders(source.senders, allowLegacyFallback);
    const templates = this.normalizeTemplates(source.templates, allowLegacyFallback);

    const config: EmailServiceConfig = {
      enabled: Boolean(source.enabled),
      senders,
      templates,
    };

    if (!config.enabled) {
      return config;
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

  private normalizeSenders(value: unknown, allowLegacyFallback: boolean): EmailSenderConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const items = value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Each email sender must be a JSON object.");
      }

      const source = item as Record<string, unknown>;
      const id = this.optionalString(source.id);
      const address = this.optionalString(source.address);
      const region = this.normalizeRegion(source.region)
        ?? (allowLegacyFallback ? this.inferLegacyRegion(source, index) : undefined);

      if (!id) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender ID is required.");
      }

      if (!address) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender address is required.");
      }

      if (!this.isValidSenderAddress(address)) {
        badRequest(
          "ADMIN_EMAIL_SERVICE_INVALID",
          `Sender address format is invalid: ${address}`,
        );
      }

      if (!region) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Sender region is required.");
      }

      return {
        id,
        address,
        region,
      } satisfies EmailSenderConfig;
    });

    const senderSet = new Set<string>();
    const regionSet = new Set<TencentSesRegion>();
    for (const item of items) {
      if (senderSet.has(item.id)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate sender ID is not allowed: ${item.id}`);
      }
      senderSet.add(item.id);

      if (regionSet.has(item.region)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate sender region is not allowed: ${item.region}`);
      }
      regionSet.add(item.region);
    }

    return items;
  }

  private normalizeTemplates(value: unknown, allowLegacyFallback: boolean): EmailServiceTemplateConfig[] {
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
      const subject = this.optionalString(source.subject)
        || (allowLegacyFallback ? this.defaultTemplateSubject(locale, name) : "");

      if (!locale) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template locale is required.");
      }

      if (!name) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template name is required.");
      }

      if (!templateId || templateId <= 0) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template ID must be a positive number.");
      }

      if (!subject) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Template subject is required.");
      }

      return {
        locale,
        templateId,
        name,
        subject,
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

  private normalizeRegion(value: unknown): TencentSesRegion | undefined {
    const normalized = this.optionalString(value);
    if (!normalized) {
      return undefined;
    }

    if (normalized === "ap-guangzhou" || normalized === "ap-hongkong") {
      return normalized;
    }

    badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Unsupported email sender region: ${normalized}`);
  }

  private assertRuntimeConfig(config: EmailServiceConfig): void {
    if (!config.enabled) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not enabled.");
    }

    if (!config.senders.length || !config.templates.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service is not fully configured.");
    }
  }

  private async resolveCredentials(): Promise<{ secretId: string; secretKey: string }> {
    const [secretId, secretKey] = await Promise.all([
      this.resolveCredentialValue(
        TENCENT_SECRET_ID_PASSWORD_KEY,
        LEGACY_TENCENT_SES_SECRET_ID_PASSWORD_KEY,
      ),
      this.resolveCredentialValue(
        TENCENT_SECRET_KEY_PASSWORD_KEY,
        LEGACY_TENCENT_SES_SECRET_KEY_PASSWORD_KEY,
      ),
    ]);

    if (!secretId || !secretKey) {
      throw new ApplicationError(
        503,
        "EMAIL_SERVICE_NOT_CONFIGURED",
        "Tencent SES credentials are not configured in password workspace.",
      );
    }

    return {
      secretId,
      secretKey,
    };
  }

  private async resolveCredentialValue(primaryKey: string, legacyKey: string): Promise<string | undefined> {
    const primaryValue = await this.commonPasswordConfigService.getValue(primaryKey);
    if (primaryValue) {
      return primaryValue;
    }

    return this.commonPasswordConfigService.getValue(legacyKey);
  }

  private resolveSender(senders: EmailSenderConfig[], region: TencentSesRegion): EmailSenderConfig {
    if (!senders.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service sender is not configured.");
    }

    const sender = senders.find((item) => item.region === region);
    if (sender) {
      return sender;
    }

    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      `Email sender is not configured for region: ${region}`,
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

    const englishFallback = templates.find((item) => item.locale === "en-US");
    return englishFallback ?? templates[0];
  }

  private resolveTemplateById(templates: EmailServiceTemplateConfig[], templateId: number): EmailServiceTemplateConfig {
    if (!templates.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service template is not configured.");
    }

    const template = templates.find((item) => item.templateId === templateId);
    if (template) {
      return template;
    }

    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      `Email template is not configured: ${templateId}`,
    );
  }

  private inferLegacyRegion(source: Record<string, unknown>, index: number): TencentSesRegion {
    const id = this.optionalString(source.id).toLowerCase();
    const address = this.optionalString(source.address).toLowerCase();
    if (id === "hongkong" || id === "hk" || address.includes("hongkong") || address.includes("hong kong")) {
      return "ap-hongkong";
    }

    if (index === 1) {
      return "ap-hongkong";
    }

    return DEFAULT_EMAIL_REGION;
  }

  private defaultTemplateSubject(locale: string, name: string): string {
    if (name) {
      return name;
    }

    return locale.toLowerCase().startsWith("zh") ? "验证码" : "Verification Code";
  }

  private isValidSenderAddress(value: string): boolean {
    return (
      /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(value) ||
      /^[^<>]+<\s*[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+\s*>$/.test(value)
    );
  }
}
