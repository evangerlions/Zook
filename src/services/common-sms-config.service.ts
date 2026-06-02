import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminSmsServiceDocument,
  SmsServiceConfig,
} from "../shared/types.ts";
import { TENCENT_SECRET_ID_PASSWORD_KEY, TENCENT_SECRET_KEY_PASSWORD_KEY } from "./common-email-config.service.ts";
import { CommonPasswordConfigService } from "./common-password-config.service.ts";
import type { TencentSmsVerificationConfig } from "./tencent-sms-verification.service.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";

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
  ) {}

  async getDocument(revision?: number): Promise<AdminSmsServiceDocument> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `SMS service revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : this.createDefaultConfig();
    return {
      app: COMMON_APP_SUMMARY,
      configKey: SMS_SERVICE_CONFIG_KEY,
      config,
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY),
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
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `SMS service revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      SMS_SERVICE_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async resolveRuntimeConfig(fallback: TencentSmsVerificationConfig): Promise<TencentSmsVerificationConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, SMS_SERVICE_CONFIG_KEY);
    const config = stored ? this.parseConfig(stored) : this.createDefaultConfig();
    if (!config.enabled) {
      return fallback;
    }

    const [secretId, secretKey] = await Promise.all([
      this.commonPasswordConfigService.getValue(TENCENT_SECRET_ID_PASSWORD_KEY),
      this.commonPasswordConfigService.getValue(TENCENT_SECRET_KEY_PASSWORD_KEY),
    ]);

    return {
      secretId: secretId ?? fallback.secretId,
      secretKey: secretKey ?? fallback.secretKey,
      sdkAppId: config.sdkAppId,
      templateId: config.templateId,
      signName: config.signName,
      region: config.region,
    };
  }

  private parseConfig(raw: string): SmsServiceConfig {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored SMS service config is invalid.");
    }

    return this.validateInput(parsed);
  }

  private validateInput(input: unknown): SmsServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("REQ_INVALID_BODY", "SMS service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const config: SmsServiceConfig = {
      enabled: Boolean(source.enabled),
      sdkAppId: this.optionalString(source.sdkAppId),
      templateId: this.optionalString(source.templateId),
      signName: this.optionalString(source.signName),
      region: this.optionalString(source.region) || DEFAULT_SMS_REGION,
    };

    if (config.enabled) {
      this.requireConfig(config.sdkAppId, "sdkAppId");
      this.requireConfig(config.templateId, "templateId");
      this.requireConfig(config.signName, "signName");
      this.requireConfig(config.region, "region");
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

  private requireConfig(value: string, field: keyof SmsServiceConfig): void {
    if (!value.trim()) {
      badRequest("REQ_INVALID_BODY", `${field} must be configured when SMS service is enabled.`);
    }
  }
}
