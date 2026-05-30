import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminSmsServiceDocument,
  SmsServiceConfig,
} from "../shared/types.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import {
  TENCENT_SECRET_ID_PASSWORD_KEY,
  TENCENT_SECRET_KEY_PASSWORD_KEY,
} from "./common-email-config.service.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { TencentSmsVerificationConfig } from "./tencent-sms-verification.service.ts";

const COMMON_APP_ID = "common";
export const SMS_SERVICE_CONFIG_KEY = "common.sms_service";
const DEFAULT_SMS_REGION = "ap-beijing";

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

export class CommonSmsConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly commonPasswordConfigService: CommonPasswordConfigService,
    private readonly logger?: StructuredLogger,
  ) {}

  async getDocument(revision?: number): Promise<AdminSmsServiceDocument> {
    const revisions = await this.appConfigService.listRevisions(
      COMMON_APP_ID,
      SMS_SERVICE_CONFIG_KEY,
    );
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(
          COMMON_APP_ID,
          SMS_SERVICE_CONFIG_KEY,
          revision,
        )
      : await this.appConfigService.getLatestRevision(
          COMMON_APP_ID,
          SMS_SERVICE_CONFIG_KEY,
        );

    if (revision && !record) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `SMS service revision ${revision} was not found.`,
      );
    }

    const config = record ? this.parseConfig(record.content) : this.createDefaultConfig();
    return {
      app: COMMON_APP_SUMMARY,
      configKey: SMS_SERVICE_CONFIG_KEY,
      config,
      updatedAt:
        record?.createdAt ??
        (await this.appConfigService.getUpdatedAt(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY)),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(input: unknown, desc?: string): Promise<AdminSmsServiceDocument> {
    const normalized = this.validateInput(input);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      SMS_SERVICE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-sms-service-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<AdminSmsServiceDocument> {
    const existing = await this.appConfigService.getRevision(
      COMMON_APP_ID,
      SMS_SERVICE_CONFIG_KEY,
      revision,
    );
    if (!existing) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `SMS service revision ${revision} was not found.`,
      );
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      SMS_SERVICE_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async getRuntimeConfig(
    fallback: TencentSmsVerificationConfig,
  ): Promise<TencentSmsVerificationConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY);
    const config = stored ? this.parseConfig(stored) : this.createDefaultConfig();
    const [secretId, secretKey] = await Promise.all([
      this.commonPasswordConfigService.getValue(TENCENT_SECRET_ID_PASSWORD_KEY),
      this.commonPasswordConfigService.getValue(TENCENT_SECRET_KEY_PASSWORD_KEY),
    ]);
    const useManagedConfig = config.enabled;
    const runtimeConfig: TencentSmsVerificationConfig = {
      secretId: secretId?.trim() || fallback.secretId,
      secretKey: secretKey?.trim() || fallback.secretKey,
      sdkAppId: useManagedConfig ? config.sdkAppId : fallback.sdkAppId,
      templateId: useManagedConfig ? config.templateId : fallback.templateId,
      signName: useManagedConfig ? config.signName : fallback.signName,
      region: useManagedConfig ? config.region : fallback.region,
    };

    this.logger?.info(
      `common SMS runtime config resolved; source=${useManagedConfig ? "common.sms_service" : "fallback"}; enabled=${config.enabled}; sdkAppId=${runtimeConfig.sdkAppId ? "set" : "missing"}; templateId=${runtimeConfig.templateId ? "set" : "missing"}; signName=${runtimeConfig.signName ? "set" : "missing"}; region=${runtimeConfig.region ?? "missing"}; secretId=${runtimeConfig.secretId ? "set" : "missing"}; secretKey=${runtimeConfig.secretKey ? "set" : "missing"}`,
    );

    return runtimeConfig;
  }

  private parseConfig(raw: string): SmsServiceConfig {
    try {
      return this.validateInput(JSON.parse(raw));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        500,
        "SYS_INTERNAL_ERROR",
        "Stored SMS service config is invalid.",
      );
    }
  }

  private validateInput(input: unknown): SmsServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "SMS service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const config: SmsServiceConfig = {
      enabled: source.enabled === true,
      sdkAppId: this.optionalString(source.sdkAppId),
      templateId: this.optionalString(source.templateId),
      signName: this.optionalString(source.signName),
      region: this.optionalString(source.region) || DEFAULT_SMS_REGION,
    };

    if (config.enabled) {
      this.requireNonEmpty(config.sdkAppId, "sdkAppId");
      this.requireNonEmpty(config.templateId, "templateId");
      this.requireNonEmpty(config.signName, "signName");
      this.requireNonEmpty(config.region, "region");
    }

    return config;
  }

  private createDefaultConfig(): SmsServiceConfig {
    return {
      enabled: false,
      sdkAppId: "",
      templateId: "",
      signName: "",
      region: DEFAULT_SMS_REGION,
    };
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private requireNonEmpty(value: string, field: keyof SmsServiceConfig): void {
    if (!value) {
      badRequest("REQ_INVALID_BODY", `${field} is required when SMS service config is enabled.`);
    }
  }
}
