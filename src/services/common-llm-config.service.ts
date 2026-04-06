import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import { maskSensitiveString } from "../shared/utils.ts";
import { SecretReferenceResolver, isSecretReference } from "./secret-reference-resolver.ts";
import type {
  AdminAppSummary,
  AdminLlmServiceDocument,
  LlmModelConfig,
  LlmModelKind,
  LlmModelRouteConfig,
  LlmProviderConfig,
  LlmRoutingStrategy,
  LlmRuntimeSnapshot,
  LlmServiceConfig,
} from "../shared/types.ts";

const COMMON_APP_ID = "common";
const LLM_SERVICE_CONFIG_KEY = "common.llm_service";
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
const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const DEFAULT_MODEL_KIND: LlmModelKind = "chat";
const VALID_MODEL_KINDS = new Set<LlmModelKind>(["chat", "embedding"]);
const VALID_ROUTING_STRATEGIES = new Set<LlmRoutingStrategy>(["auto", "fixed"]);
const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const WEIGHT_PRECISION = 100;

export class CommonLlmConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly secretReferenceResolver?: SecretReferenceResolver,
  ) {}

  async getDocument(revision?: number): Promise<Omit<AdminLlmServiceDocument, "runtime">> {
    const revisions = await this.appConfigService.listRevisions(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `LLM service revision ${revision} was not found.`);
    }

    const config = record ? this.parseConfig(record.content) : await this.getCurrentConfig();

    return {
      app: COMMON_APP_SUMMARY,
      configKey: LLM_SERVICE_CONFIG_KEY,
      config: this.maskSensitiveConfig(config),
      updatedAt: record?.createdAt ?? await this.getUpdatedAt(),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async updateConfig(input: unknown, desc?: string): Promise<Omit<AdminLlmServiceDocument, "runtime">> {
    const existingConfig = await this.getCurrentConfig();
    const normalized = this.validateInput(input, existingConfig);
    await this.appConfigService.setValue(
      COMMON_APP_ID,
      LLM_SERVICE_CONFIG_KEY,
      JSON.stringify(normalized, null, 2),
      desc?.trim() || "common-llm-service-update",
    );
    return this.getDocument();
  }

  async restoreConfig(revision: number, desc?: string): Promise<Omit<AdminLlmServiceDocument, "runtime">> {
    const existing = await this.appConfigService.getRevision(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `LLM service revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      COMMON_APP_ID,
      LLM_SERVICE_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );

    return this.getDocument();
  }

  async getCurrentConfig(): Promise<LlmServiceConfig> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY);
    return stored ? this.parseConfig(stored) : this.createDefaultConfig();
  }

  async getRuntimeConfig(): Promise<LlmServiceConfig | undefined> {
    const stored = await this.appConfigService.getValue(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY);
    if (!stored) {
      return undefined;
    }

    const config = this.parseConfig(stored);
    if (!this.secretReferenceResolver) {
      return config;
    }

    try {
      const resolvedConfig = await this.secretReferenceResolver.resolveValue(config);
      return this.validateInput(resolvedConfig, config);
    } catch (error) {
      const message = error instanceof Error ? error.message : "LLM password references are invalid.";
      throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", message);
    }
  }

  async hasStoredConfig(): Promise<boolean> {
    return Boolean(await this.appConfigService.getValue(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY));
  }

  createEmptyRuntimeSnapshot(): LlmRuntimeSnapshot {
    return {
      generatedAt: new Date().toISOString(),
      models: [],
    };
  }

  private async getUpdatedAt(): Promise<string | undefined> {
    return this.appConfigService.getUpdatedAt(COMMON_APP_ID, LLM_SERVICE_CONFIG_KEY);
  }

  private parseConfig(raw: string): LlmServiceConfig {
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored LLM service config is invalid.");
    }

    return this.validateInput(parsed, this.createDefaultConfig());
  }

  private validateInput(input: unknown, existingConfig?: LlmServiceConfig): LlmServiceConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "LLM service config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const providers = this.normalizeProviders(source.providers, existingConfig?.providers ?? []);
    const models = this.normalizeModels(source.models, providers);
    const defaultModelKey = this.optionalString(source.defaultModelKey);
    const config: LlmServiceConfig = {
      enabled: Boolean(source.enabled),
      defaultModelKey,
      providers,
      models,
    };

    if (!config.enabled) {
      if (config.defaultModelKey && !config.models.some((item) => item.key === config.defaultModelKey)) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", "defaultModelKey must reference an existing model.");
      }
      return config;
    }

    if (!config.providers.length) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "At least one provider is required when LLM service is enabled.");
    }

    if (!config.models.length) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "At least one model is required when LLM service is enabled.");
    }

    if (!config.defaultModelKey) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "defaultModelKey is required when LLM service is enabled.");
    }

    const defaultModel = config.models.find((item) => item.key === config.defaultModelKey);
    if (!defaultModel) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "defaultModelKey must reference an existing model.");
    }

    if (defaultModel.kind !== "chat") {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "defaultModelKey must reference a chat model.");
    }

    return config;
  }

  private createDefaultConfig(): LlmServiceConfig {
    return {
      enabled: false,
      defaultModelKey: "",
      providers: [],
      models: [],
    };
  }

  private normalizeProviders(value: unknown, existingProviders: LlmProviderConfig[]): LlmProviderConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const existingMap = new Map(existingProviders.map((item) => [item.key, item]));
    const providers = value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Provider #${index + 1} must be a JSON object.`);
      }

      const source = item as Record<string, unknown>;
      const key = this.normalizeProviderKey(source.key);
      const label = this.requireTrimmedString(source.label, `Provider #${index + 1} label is required.`);
      const enabled = Boolean(source.enabled);
      const baseUrl = this.normalizeBaseUrl(source.baseUrl);
      const timeoutMs = this.normalizeTimeout(source.timeoutMs);
      const existing = existingMap.get(key);
      const apiKey = this.resolveSensitiveField(source.apiKey, existing?.apiKey);

      if (!baseUrl) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Provider ${key} baseUrl is required.`);
      }

      if (enabled && !apiKey) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Provider ${key} apiKey is required when enabled.`);
      }

      return {
        key,
        label,
        enabled,
        baseUrl,
        apiKey,
        timeoutMs,
      } satisfies LlmProviderConfig;
    });

    this.assertUnique(providers.map((item) => item.key), "provider key");
    return providers;
  }

  private normalizeModels(value: unknown, providers: LlmProviderConfig[]): LlmModelConfig[] {
    if (!Array.isArray(value)) {
      return [];
    }

    const providerKeys = new Set(providers.map((item) => item.key));
    const models = value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Model #${index + 1} must be a JSON object.`);
      }

      const source = item as Record<string, unknown>;
      const key = this.normalizeModelKey(source.key);
      const label = this.requireTrimmedString(source.label, `Model ${key || `#${index + 1}`} label is required.`);
      const kind = this.normalizeKind(source.kind);
      const strategy = this.normalizeStrategy(source.strategy);
      const routes = this.normalizeRoutes(source.routes, key, providerKeys);

      return {
        key,
        label,
        kind,
        strategy,
        routes,
      } satisfies LlmModelConfig;
    });

    this.assertUnique(models.map((item) => item.key), "model key");
    return models;
  }

  private normalizeRoutes(
    value: unknown,
    modelKey: string,
    providerKeys: Set<string>,
  ): LlmModelRouteConfig[] {
    if (!Array.isArray(value)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} routes must be an array.`);
    }

    if (!value.length) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} must contain at least one route.`);
    }

    const routes = value.map((item, index) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Model ${modelKey} route #${index + 1} must be a JSON object.`);
      }

      const source = item as Record<string, unknown>;
      const provider = this.normalizeProviderKey(source.provider);
      const providerModel = this.requireTrimmedString(
        source.providerModel,
        `Model ${modelKey} route #${index + 1} providerModel is required.`,
      );
      const enabled = Boolean(source.enabled);
      const weight = this.normalizeWeight(source.weight, modelKey, index + 1);

      if (!providerKeys.has(provider)) {
        badRequest(
          "ADMIN_LLM_SERVICE_INVALID",
          `Model ${modelKey} route #${index + 1} references unknown provider ${provider}.`,
        );
      }

      return {
        provider,
        providerModel,
        enabled,
        weight,
      } satisfies LlmModelRouteConfig;
    });

    const enabledRoutes = routes.filter((item) => item.enabled);
    if (enabledRoutes.length) {
      const totalWeight = enabledRoutes.reduce((sum, item) => sum + item.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        badRequest(
          "ADMIN_LLM_SERVICE_INVALID",
          `Enabled routes of model ${modelKey} must add up to 100, received ${totalWeight.toFixed(2)}.`,
        );
      }
    }

    return routes;
  }

  private normalizeProviderKey(value: unknown): string {
    const normalized = this.requireTrimmedString(value, "Provider key is required.");
    if (!PROVIDER_KEY_PATTERN.test(normalized)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Provider key is invalid: ${normalized}`);
    }
    return normalized;
  }

  private normalizeModelKey(value: unknown): string {
    const normalized = this.requireTrimmedString(value, "Model key is required.");
    if (!MODEL_KEY_PATTERN.test(normalized)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Model key is invalid: ${normalized}`);
    }
    return normalized;
  }

  private normalizeStrategy(value: unknown): LlmRoutingStrategy {
    const normalized = this.requireTrimmedString(value, "Model strategy is required.") as LlmRoutingStrategy;
    if (!VALID_ROUTING_STRATEGIES.has(normalized)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Unsupported LLM routing strategy: ${String(value)}.`);
    }
    return normalized;
  }

  private normalizeKind(value: unknown): LlmModelKind {
    const normalized = this.optionalString(value);
    if (!normalized) {
      return DEFAULT_MODEL_KIND;
    }

    if (!VALID_MODEL_KINDS.has(normalized as LlmModelKind)) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", `Unsupported LLM model kind: ${String(value)}.`);
    }

    return normalized as LlmModelKind;
  }

  private normalizeWeight(value: unknown, modelKey: string, routeIndex: number): number {
    if (typeof value !== "number" || !Number.isFinite(value)) {
      badRequest(
        "ADMIN_LLM_SERVICE_INVALID",
        `Model ${modelKey} route #${routeIndex} weight must be a number.`,
      );
    }

    if (value <= 0) {
      badRequest(
        "ADMIN_LLM_SERVICE_INVALID",
        `Model ${modelKey} route #${routeIndex} weight must be greater than 0.`,
      );
    }

    const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
    if (Math.abs(value - normalized) > 0.000001) {
      badRequest(
        "ADMIN_LLM_SERVICE_INVALID",
        `Model ${modelKey} route #${routeIndex} weight must keep at most 2 decimals.`,
      );
    }

    return normalized;
  }

  private normalizeBaseUrl(value: unknown): string {
    const normalized = this.optionalString(value);
    return normalized.replace(/\/+$/, "");
  }

  private normalizeTimeout(value: unknown): number {
    if (value === undefined || value === null || value === "") {
      return DEFAULT_PROVIDER_TIMEOUT_MS;
    }

    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", "Provider timeoutMs must be a positive number.");
    }

    return Math.round(value);
  }

  private requireTrimmedString(value: unknown, message: string): string {
    const normalized = this.optionalString(value);
    if (!normalized) {
      badRequest("ADMIN_LLM_SERVICE_INVALID", message);
    }
    return normalized;
  }

  private optionalString(value: unknown): string {
    return typeof value === "string" ? value.trim() : "";
  }

  private assertUnique(values: string[], label: string): void {
    const seen = new Set<string>();
    for (const value of values) {
      if (seen.has(value)) {
        badRequest("ADMIN_LLM_SERVICE_INVALID", `Duplicate ${label} is not allowed: ${value}`);
      }
      seen.add(value);
    }
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

  private maskSensitiveConfig(config: LlmServiceConfig): LlmServiceConfig {
    return {
      ...config,
      providers: config.providers.map((provider) => ({
        ...provider,
        apiKey: isSecretReference(provider.apiKey) ? provider.apiKey : maskSensitiveString(provider.apiKey),
      })),
    };
  }
}
