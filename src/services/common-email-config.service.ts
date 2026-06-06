import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import {
  assertRuntimeEmailServiceConfig,
  createDefaultEmailServiceConfig,
  DEFAULT_EMAIL_REGION,
  DEFAULT_TEMPLATE_LOCALE,
  parseEmailServiceConfig,
  resolveEmailProviderRegion,
  resolveEmailRegionConfig,
  resolveEmailSender,
  resolveEmailTemplate,
  resolveEmailTemplateById,
  validateEmailServiceConfig,
  VERIFICATION_EMAIL_TEMPLATE_NAME,
} from "./common-email-config-normalizer.ts";
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
export { VERIFICATION_EMAIL_TEMPLATE_NAME };

export class CommonEmailConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly logger?: StructuredLogger,
  ) {}

  async getDocument(revision?: number): Promise<AdminEmailServiceDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY, revision)
      : await this.getCurrentConfigRecord();

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Email service revision ${revision} was not found.`);
    }

    const config = record
      ? parseEmailServiceConfig(record.content)
      : createDefaultEmailServiceConfig();
    this.logConfigSnapshot("common email config document resolved", config, {
      source: record?.revision ? "latest-revision" : "direct-record",
      revision: record?.revision,
      updatedAt: record?.createdAt ?? await this.getUpdatedAt(),
    });
    return this.toDocument(config, {
      updatedAt: record?.createdAt ?? await this.getUpdatedAt(),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    });
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminEmailServiceDocument> {
    const normalized = validateEmailServiceConfig(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      EMAIL_SERVICE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-email-service-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<AdminEmailServiceDocument> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `Email service revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      EMAIL_SERVICE_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
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
    const config = await this.getCurrentRuntimeConfig();
    this.logConfigSnapshot("common email runtime config resolved", config, {
      source: "runtime",
      region,
      templateName,
    });

    assertRuntimeEmailServiceConfig(config);
    const credentials = await this.resolveCredentials();
    const resolvedRegion = resolveEmailProviderRegion(region);

    const regionConfig = resolveEmailRegionConfig(config.regions, resolvedRegion);
    return {
      config,
      resolvedRegion,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      regionConfig,
      sender: resolveEmailSender(regionConfig, resolvedRegion),
      template: resolveEmailTemplate(regionConfig.templates, locale, templateName),
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
    const config = await this.getCurrentRuntimeConfig();
    this.logConfigSnapshot("common email runtime template config resolved", config, {
      source: "runtime-by-template-id",
      region,
      templateId,
    });

    assertRuntimeEmailServiceConfig(config);
    const credentials = await this.resolveCredentials();
    const resolvedRegion = resolveEmailProviderRegion(region);

    const regionConfig = resolveEmailRegionConfig(config.regions, resolvedRegion);
    return {
      config,
      resolvedRegion,
      secretId: credentials.secretId,
      secretKey: credentials.secretKey,
      regionConfig,
      sender: resolveEmailSender(regionConfig, resolvedRegion),
      template: resolveEmailTemplateById(regionConfig.templates, templateId),
    };
  }

  private async getUpdatedAt(): Promise<string | undefined> {
    return this.appConfigService.getUpdatedAt(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
  }

  private async getCurrentConfigRecord() {
    return this.appConfigService.getLatestRevision(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
  }

  private async getCurrentRuntimeConfig(): Promise<EmailServiceConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, EMAIL_SERVICE_CONFIG_KEY);
    return stored
      ? parseEmailServiceConfig(stored)
      : createDefaultEmailServiceConfig();
  }

  private logConfigSnapshot(
    event: string,
    config: EmailServiceConfig,
    meta: {
      source: string;
      revision?: number;
      updatedAt?: string;
      region?: TencentSesRegion;
      templateId?: number;
      templateName?: string;
    },
  ): void {
    if (!this.logger) {
      return;
    }

    const templateIds = config.regions.flatMap((item) => item.templates.map((template) => template.templateId));
    this.logger.info(
      `${event}; source=${meta.source}; enabled=${config.enabled}; revision=${meta.revision ?? "none"}; updatedAt=${meta.updatedAt ?? "unknown"}; region=${meta.region ?? "n/a"}; templateId=${meta.templateId ?? "n/a"}; templateName=${meta.templateName ?? "n/a"}; regions=${config.regions.length}; templateIds=${templateIds.join(",") || "none"}`,
    );
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
}
