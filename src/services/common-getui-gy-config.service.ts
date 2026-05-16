import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminGetuiGyCredentialRevealDocument,
  GetuiGyAppCredentials,
  GetuiGySensitiveCredentialField,
  AdminGetuiGyServiceDocument,
  GetuiGyServiceConfig,
} from "../shared/types.ts";
import {
  maskSensitiveString,
  matchesMaskedSensitiveString,
} from "../shared/utils.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";

const COMMON_APP_ID = "common";
export const GETUI_GY_CONFIG_KEY = "common.getui_gy_service";
export const GETUI_GY_CREDENTIAL_READ_OPERATION =
  "getui_gy.credential.read";
const DEFAULT_ENDPOINT =
  "https://openapi-gy.getui.com/v2/gy/ct_login/gy_get_pn";

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

export interface GetuiGyRuntimeConfig {
  enabled: true;
  endpoint: string;
  timeoutMs: number;
  appId: string;
  appKey: string;
  appSecret: string;
  masterSecret: string;
  zookAppId: string;
}

export class CommonGetuiGyConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
  ) {}

  async getDocument(revision?: number): Promise<AdminGetuiGyServiceDocument> {
    const revisions = await this.appConfigService.listRevisions(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
    );
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(
          COMMON_APP_ID,
          GETUI_GY_CONFIG_KEY,
          revision,
        )
      : await this.appConfigService.getLatestRevision(
          COMMON_APP_ID,
          GETUI_GY_CONFIG_KEY,
        );

    if (revision && !record) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `Getui GeYan service revision ${revision} was not found.`,
      );
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig();
    return {
      app: COMMON_APP_SUMMARY,
      configKey: GETUI_GY_CONFIG_KEY,
      config: this.maskSensitiveConfig(config),
      updatedAt:
        record?.createdAt ??
        (await this.appConfigService.getUpdatedAt(COMMON_APP_ID, GETUI_GY_CONFIG_KEY)),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(
    input: unknown,
    desc?: string,
  ): Promise<AdminGetuiGyServiceDocument> {
    const existing = await this.getCurrentConfig();
    const normalized = this.preserveMaskedSensitiveValues(
      this.validateInput(input),
      existing,
    );
    if (normalized.enabled) {
      this.assertRuntimeConfig(normalized);
    }
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-getui-gy-service-update",
    );
    return this.getDocument();
  }

  async restoreConfig(
    revision: number,
    desc?: string,
  ): Promise<AdminGetuiGyServiceDocument> {
    const existing = await this.appConfigService.getRevision(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
      revision,
    );
    if (!existing) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `Getui GeYan service revision ${revision} was not found.`,
      );
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
    return this.getDocument();
  }

  async revealCredentialValue(
    zookAppId: string,
    field: GetuiGySensitiveCredentialField,
  ): Promise<AdminGetuiGyCredentialRevealDocument> {
    const config = await this.getCurrentConfig();
    const credentials = config.apps[zookAppId];
    if (!credentials) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `Getui GeYan credentials are not configured for Zook app ${zookAppId}.`,
      );
    }

    return {
      app: COMMON_APP_SUMMARY,
      configKey: GETUI_GY_CONFIG_KEY,
      zookAppId,
      field,
      value: credentials[field],
    };
  }

  async getCurrentConfig(): Promise<GetuiGyServiceConfig> {
    const stored = await this.appConfigService.getValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
    );
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  async getRuntimeConfig(appId: string): Promise<GetuiGyRuntimeConfig> {
    const config = await this.getCurrentConfig();

    if (!config.enabled) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        "Getui GeYan one-click login service is not enabled.",
      );
    }

    this.assertRuntimeConfig(config);
    const credentials = config.apps[appId];
    if (!credentials) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        `Getui GeYan credentials are not configured for Zook app ${appId}.`,
      );
    }
    this.assertAppCredentials(appId, credentials);

    return {
      enabled: true,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
      appId: credentials.appId,
      appKey: credentials.appKey,
      appSecret: credentials.appSecret,
      masterSecret: credentials.masterSecret,
      zookAppId: appId,
    };
  }

  async initializeDefaultConfig(
    desc = "common-getui-gy-service-init",
  ): Promise<boolean> {
    const existing = await this.appConfigService.getValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
    );
    if (existing) {
      return false;
    }

    await this.appConfigService.setValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
      JSON.stringify(this.createDefaultConfig(), null, 2),
      desc,
    );
    return true;
  }

  private parseConfig(raw: string): GetuiGyServiceConfig {
    try {
      return this.validateInput(JSON.parse(raw));
    } catch (error) {
      if (error instanceof ApplicationError) {
        throw error;
      }
      throw new ApplicationError(
        500,
        "SYS_INTERNAL_ERROR",
        "Stored Getui GeYan service config is invalid.",
      );
    }
  }

  private validateInput(input: unknown): GetuiGyServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Getui GeYan service config must be a JSON object.",
      );
    }

    const source = input as Record<string, unknown>;
    const config = {
      enabled: source.enabled === true,
      endpoint: this.optionalString(source.endpoint) || DEFAULT_ENDPOINT,
      timeoutMs: this.optionalPositiveNumber(source.timeoutMs) || 8000,
      apps: this.normalizeAppCredentials(source.apps),
    } satisfies GetuiGyServiceConfig;

    return config;
  }

  private assertRuntimeConfig(config: GetuiGyServiceConfig): void {
    if (Object.keys(config.apps).length === 0) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        "At least one Zook AppID to Getui GeYan credential mapping must be configured.",
      );
    }

    Object.entries(config.apps).forEach(([zookAppId, credentials]) => {
      this.assertAppCredentials(zookAppId, credentials);
    });

    try {
      const url = new URL(config.endpoint);
      if (url.protocol !== "https:") {
        throw new Error("endpoint must use https");
      }
    } catch {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        "Getui GeYan endpoint is invalid.",
      );
    }
  }

  private assertAppCredentials(
    zookAppId: string,
    credentials: GetuiGyAppCredentials,
  ): void {
    if (
      !credentials.appId ||
      !credentials.appKey ||
      !credentials.appSecret ||
      !credentials.masterSecret
    ) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        `Getui GeYan AppID, AppKey, AppSecret, and MasterSecret must be configured for Zook app ${zookAppId}.`,
      );
    }
  }

  private maskSensitiveConfig(config: GetuiGyServiceConfig): GetuiGyServiceConfig {
    return {
      ...config,
      apps: Object.fromEntries(
        Object.entries(config.apps).map(([zookAppId, credentials]) => [
          zookAppId,
          {
            ...credentials,
            appKey: maskSensitiveString(credentials.appKey),
            appSecret: maskSensitiveString(credentials.appSecret),
            masterSecret: maskSensitiveString(credentials.masterSecret),
          },
        ]),
      ),
    };
  }

  private preserveMaskedSensitiveValues(
    next: GetuiGyServiceConfig,
    previous: GetuiGyServiceConfig,
  ): GetuiGyServiceConfig {
    return {
      ...next,
      apps: Object.fromEntries(
        Object.entries(next.apps).map(([zookAppId, credentials]) => {
          const previousCredentials = previous.apps[zookAppId];
          if (!previousCredentials) {
            return [zookAppId, credentials];
          }

          return [
            zookAppId,
            {
              ...credentials,
              appKey: this.preserveMaskedValue(
                credentials.appKey,
                previousCredentials.appKey,
              ),
              appSecret: this.preserveMaskedValue(
                credentials.appSecret,
                previousCredentials.appSecret,
              ),
              masterSecret: this.preserveMaskedValue(
                credentials.masterSecret,
                previousCredentials.masterSecret,
              ),
            },
          ];
        }),
      ),
    };
  }

  private preserveMaskedValue(nextValue: string, previousValue: string): string {
    return matchesMaskedSensitiveString(nextValue, previousValue)
      ? previousValue
      : nextValue;
  }

  private createDefaultConfig(): GetuiGyServiceConfig {
    return {
      enabled: false,
      endpoint: DEFAULT_ENDPOINT,
      timeoutMs: 8000,
      apps: {},
    };
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private optionalPositiveNumber(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
      ? Math.floor(value)
      : 0;
  }

  private normalizeAppCredentials(
    value: unknown,
  ): Record<string, GetuiGyAppCredentials> {
    const result: Record<string, GetuiGyAppCredentials> = {};

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.entries(value as Record<string, unknown>).forEach(
        ([zookAppId, rawCredentials]) => {
          const key = zookAppId.trim();
          if (
            key &&
            rawCredentials &&
            typeof rawCredentials === "object" &&
            !Array.isArray(rawCredentials)
          ) {
            const source = rawCredentials as Record<string, unknown>;
            result[key] = {
              appId: this.optionalString(source.appId),
              appKey: this.optionalString(source.appKey),
              appSecret: this.optionalString(source.appSecret),
              masterSecret: this.optionalString(source.masterSecret),
            };
          }
        },
      );
    }

    return result;
  }
}
