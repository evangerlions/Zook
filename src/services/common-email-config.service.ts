import { AppConfigService } from "./app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import type {
  AdminAppSummary,
  AdminEmailServiceDocument,
  EmailServiceConfig,
  EmailServiceRegionConfig,
  EmailSenderConfig,
  EmailServiceTemplateConfig,
  TencentSesRegion,
} from "../shared/types.ts";

const COMMON_APP_ID = "common";
const EMAIL_SERVICE_CONFIG_KEY = "common.email_service_regions";
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
  logSecret: {
    keyId: "common",
    secretMasked: "",
    updatedAt: "",
  },
};
const DEFAULT_EMAIL_REGION: TencentSesRegion = "ap-guangzhou";
const EMAIL_REGIONS: TencentSesRegion[] = ["ap-guangzhou", "ap-hongkong"];
const DEFAULT_TEMPLATE_LOCALE = "zh-CN";
export const VERIFICATION_EMAIL_TEMPLATE_NAME = "verify-code";

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
    templateName?: string,
  ): Promise<{
    config: EmailServiceConfig;
    resolvedRegion: TencentSesRegion;
    secretId: string;
    secretKey: string;
    regionConfig: EmailServiceRegionConfig;
    sender: EmailSenderConfig;
    template: EmailServiceTemplateConfig;
  }> {
    const config = this.getStoredConfig();

    this.assertRuntimeConfig(config);
    const credentials = await this.resolveCredentials();
    const resolvedRegion = this.resolveProviderRegion(region);

    const regionConfig = this.resolveRegionConfig(config.regions, resolvedRegion);
    return {
      config,
      resolvedRegion,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      regionConfig,
      sender: this.resolveSender(regionConfig, resolvedRegion),
      template: this.resolveTemplate(regionConfig.templates, locale, templateName),
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
    regionConfig: EmailServiceRegionConfig;
    sender: EmailSenderConfig;
    template: EmailServiceTemplateConfig;
  }> {
    const config = this.getStoredConfig();

    this.assertRuntimeConfig(config);
    const credentials = await this.resolveCredentials();
    const resolvedRegion = this.resolveProviderRegion(region);

    const regionConfig = this.resolveRegionConfig(config.regions, resolvedRegion);
    return {
      config,
      resolvedRegion,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      regionConfig,
      sender: this.resolveSender(regionConfig, resolvedRegion),
      template: this.resolveTemplateById(regionConfig.templates, templateId),
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
    const regions = this.normalizeRegions(source.regions, allowLegacyFallback);

    const config: EmailServiceConfig = {
      enabled: Boolean(source.enabled),
      regions,
    };

    this.assertUniqueTemplateIds(config.regions);

    if (!config.enabled) {
      return config;
    }

    this.assertVerificationTemplateNames(config.regions);

    if (!config.regions.some((item) => item.sender && item.templates.length)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "At least one region must have sender and templates configured.");
    }
    return config;
  }

  private createDefaultConfig(): EmailServiceConfig {
    return {
      enabled: false,
      regions: EMAIL_REGIONS.map((region) => ({
        region,
        sender: null,
        templates: [],
      })),
    };
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private optionalNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) ? value : 0;
  }

  private normalizeRegions(value: unknown, allowLegacyFallback: boolean): EmailServiceRegionConfig[] {
    if (!Array.isArray(value)) {
      if (allowLegacyFallback) {
        return this.createDefaultConfig().regions;
      }
      return this.createDefaultConfig().regions;
    }

    const regions = value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Each email region config must be a JSON object.");
      }

      const source = item as Record<string, unknown>;
      const region = this.normalizeRegion(source.region);
      if (!region) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email region is required.");
      }

      return {
        region,
        sender: this.normalizeSender(source.sender),
        templates: this.normalizeTemplates(source.templates, allowLegacyFallback),
      } satisfies EmailServiceRegionConfig;
    });

    const normalizedMap = new Map<TencentSesRegion, EmailServiceRegionConfig>();
    for (const item of regions) {
      if (normalizedMap.has(item.region)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate email region is not allowed: ${item.region}`);
      }
      normalizedMap.set(item.region, item);
    }

    return EMAIL_REGIONS.map((region) => normalizedMap.get(region) ?? {
      region,
      sender: null,
      templates: [],
    });
  }

  private normalizeSender(value: unknown): EmailSenderConfig | null {
    if (value == null || value === "") {
      return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("ADMIN_EMAIL_SERVICE_INVALID", "Email sender must be a JSON object.");
    }

    const source = value as Record<string, unknown>;
    const id = this.optionalString(source.id);
    const address = this.optionalString(source.address);

    if (!id && !address) {
      return null;
    }

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

    return {
      id,
      address,
    };
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

    const templateKeySet = new Set<string>();
    for (const item of items) {
      const templateKey = `${item.name}::${item.locale}`;
      if (templateKeySet.has(templateKey)) {
        badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate template name + locale is not allowed: ${item.name} + ${item.locale}`);
      }
      templateKeySet.add(templateKey);
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

    if (!config.regions.length) {
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

  private resolveRegionConfig(regions: EmailServiceRegionConfig[], region: TencentSesRegion): EmailServiceRegionConfig {
    const regionConfig = regions.find((item) => item.region === region);
    if (regionConfig) {
      return regionConfig;
    }

    throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", `Email region is not configured: ${region}`);
  }

  private resolveSender(regionConfig: EmailServiceRegionConfig, region: TencentSesRegion): EmailSenderConfig {
    if (regionConfig.sender) {
      return regionConfig.sender;
    }

    throw new ApplicationError(
      503,
      "EMAIL_SERVICE_NOT_CONFIGURED",
      `Email sender is not configured for region: ${region}`,
    );
  }

  private resolveProviderRegion(region: TencentSesRegion): TencentSesRegion {
    return region === "ap-guangzhou" ? "ap-guangzhou" : "ap-hongkong";
  }

  private resolveTemplate(
    templates: EmailServiceTemplateConfig[],
    locale: string,
    templateName = "",
  ): EmailServiceTemplateConfig {
    if (!templates.length) {
      throw new ApplicationError(503, "EMAIL_SERVICE_NOT_CONFIGURED", "Email service template is not configured.");
    }

    const normalizedLocale = this.normalizeLocale(locale || DEFAULT_TEMPLATE_LOCALE);
    const preferredName = this.optionalString(templateName);
    const candidateTemplates = preferredName
      ? templates.filter((item) => item.name === preferredName)
      : templates;
    if (preferredName && !candidateTemplates.length) {
      throw new ApplicationError(
        503,
        "EMAIL_SERVICE_NOT_CONFIGURED",
        `Email template is not configured: ${preferredName}`,
      );
    }

    const scopedTemplates = candidateTemplates.length ? candidateTemplates : templates;
    const exactMatch = scopedTemplates.find((item) => item.locale === normalizedLocale);
    if (exactMatch) {
      return exactMatch;
    }

    const languageOnly = normalizedLocale.split("-")[0];
    const fallbackMatch = scopedTemplates.find((item) => item.locale === languageOnly);
    if (fallbackMatch) {
      return fallbackMatch;
    }

    const englishFallback = scopedTemplates.find((item) => item.locale === "en-US");
    return englishFallback ?? scopedTemplates[0];
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

  private assertUniqueTemplateIds(regions: EmailServiceRegionConfig[]): void {
    const templateIds = new Set<number>();
    for (const regionConfig of regions) {
      for (const template of regionConfig.templates) {
        if (templateIds.has(template.templateId)) {
          badRequest("ADMIN_EMAIL_SERVICE_INVALID", `Duplicate template ID is not allowed: ${template.templateId}`);
        }
        templateIds.add(template.templateId);
      }
    }
  }

  private assertVerificationTemplateNames(regions: EmailServiceRegionConfig[]): void {
    for (const regionConfig of regions) {
      if (!regionConfig.templates.length) {
        continue;
      }

      const hasVerificationTemplate = regionConfig.templates.some(
        (template) => template.name === VERIFICATION_EMAIL_TEMPLATE_NAME,
      );
      if (!hasVerificationTemplate) {
        badRequest(
          "ADMIN_EMAIL_SERVICE_INVALID",
          `Region ${regionConfig.region} must include a template named ${VERIFICATION_EMAIL_TEMPLATE_NAME}.`,
        );
      }
    }
  }
}
