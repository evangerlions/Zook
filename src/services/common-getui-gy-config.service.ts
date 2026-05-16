import { ApplicationError, badRequest } from "../shared/errors.ts";
import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { SecretReferenceResolver } from "./secret-reference-resolver.ts";

const COMMON_APP_ID = "common";
const GETUI_GY_CONFIG_KEY = "common.getui_gy_service";
const DEFAULT_ENDPOINT =
  "https://openapi-gy.getui.com/v2/gy/ct_login/gy_get_pn";

export interface GetuiGyServiceConfig {
  enabled: boolean;
  appId: string;
  endpoint: string;
  appKey: string;
  masterSecret: string;
  timeoutMs: number;
}

export class CommonGetuiGyConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly secretReferenceResolver: SecretReferenceResolver,
  ) {}

  async getRuntimeConfig(): Promise<GetuiGyServiceConfig> {
    const stored = await this.appConfigService.getValue(
      COMMON_APP_ID,
      GETUI_GY_CONFIG_KEY,
    );
    const config = stored
      ? this.parseConfig(stored)
      : this.createDefaultConfig();

    if (!config.enabled) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        "Getui GeYan one-click login service is not enabled.",
      );
    }

    let resolved: GetuiGyServiceConfig;
    try {
      resolved = await this.secretReferenceResolver.resolveValue(config);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Getui GeYan secret references are invalid.";
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        message,
      );
    }

    this.assertRuntimeConfig(resolved);
    return resolved;
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
      appId: this.optionalString(source.appId),
      endpoint: this.optionalString(source.endpoint) || DEFAULT_ENDPOINT,
      appKey: this.optionalString(source.appKey),
      masterSecret: this.optionalString(source.masterSecret),
      timeoutMs: this.optionalPositiveNumber(source.timeoutMs) || 8000,
    } satisfies GetuiGyServiceConfig;

    if (!config.enabled) {
      return config;
    }

    this.assertRuntimeConfig(config);
    return config;
  }

  private assertRuntimeConfig(config: GetuiGyServiceConfig): void {
    if (!config.appId || !config.appKey || !config.masterSecret) {
      throw new ApplicationError(
        503,
        "ONE_CLICK_SERVICE_NOT_CONFIGURED",
        "Getui GeYan appId, appKey, and masterSecret must be configured.",
      );
    }

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

  private createDefaultConfig(): GetuiGyServiceConfig {
    return {
      enabled: false,
      appId: "",
      endpoint: DEFAULT_ENDPOINT,
      appKey: "{{ zook.ps.getui.gy.app_key }}",
      masterSecret: "{{ zook.ps.getui.gy.master_secret }}",
      timeoutMs: 8000,
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
}
