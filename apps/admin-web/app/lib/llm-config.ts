import type {
  AdminLlmServiceDocument,
  LlmServiceConfig,
  LlmConfigDraft,
  LlmModelKind,
  LlmModelDraft,
  LlmModelRuntimeStatus,
  LlmProviderDraft,
  LlmRouteDraft,
  LlmRoutingStrategy,
} from "./types";

const PROVIDER_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;
const MODEL_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const VALID_ROUTING_STRATEGIES = new Set<LlmRoutingStrategy>(["auto", "fixed"]);
const VALID_MODEL_KINDS = new Set<LlmModelKind>(["chat", "embedding"]);
const DEFAULT_MODEL_KIND: LlmModelKind = "chat";
const DEFAULT_PROVIDER_TIMEOUT_MS = 30000;
const WEIGHT_PRECISION = 100;

export function createDefaultLlmConfig(): LlmConfigDraft {
  return {
    enabled: false,
    defaultModelKey: "",
    providers: [],
    models: [],
  };
}

export function createEmptyLlmProvider(): LlmProviderDraft {
  return {
    key: "",
    label: "",
    enabled: true,
    baseUrl: "",
    apiKey: "",
    timeoutMs: "30000",
  };
}

export function createEmptyLlmRoute(defaultProvider = ""): LlmRouteDraft {
  return {
    provider: defaultProvider,
    providerModel: "",
    enabled: true,
    weight: "100",
  };
}

export function createEmptyLlmModel(): LlmModelDraft {
  return {
    key: "",
    label: "",
    kind: "chat",
    strategy: "auto",
    routes: [],
  };
}

export function cloneLlmConfig(config: LlmConfigDraft | LlmServiceConfig = createDefaultLlmConfig()): LlmConfigDraft {
  return {
    enabled: Boolean(config?.enabled),
    defaultModelKey: String(config?.defaultModelKey ?? ""),
    providers: Array.isArray(config?.providers)
      ? config.providers.map((item) => ({
          key: String(item?.key ?? ""),
          label: String(item?.label ?? ""),
          enabled: Boolean(item?.enabled),
          baseUrl: String(item?.baseUrl ?? ""),
          apiKey: String(item?.apiKey ?? ""),
          timeoutMs: item?.timeoutMs == null ? "30000" : String(item.timeoutMs),
        }))
      : [],
    models: Array.isArray(config?.models)
      ? config.models.map((item) => ({
          key: String(item?.key ?? ""),
          label: String(item?.label ?? ""),
          kind: item?.kind === "embedding" ? "embedding" : "chat",
          strategy: item?.strategy === "fixed" ? "fixed" : "auto",
          routes: Array.isArray(item?.routes)
            ? item.routes.map((route) => ({
                provider: String(route?.provider ?? ""),
                providerModel: String(route?.providerModel ?? ""),
                enabled: Boolean(route?.enabled),
                weight: route?.weight == null ? "0" : String(route.weight),
              }))
            : [],
        }))
      : [],
  };
}

export function normalizeLlmDocument(document: AdminLlmServiceDocument | null) {
  return document;
}

export function createEmptyLlmSummary() {
  return {
    requestCount: 0,
    successCount: 0,
    failureCount: 0,
    successRate: 100,
    avgFirstByteLatencyMs: 0,
    avgTotalLatencyMs: 0,
    p95FirstByteLatencyMs: 0,
    p95TotalLatencyMs: 0,
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
}

export function createEmptyLlmSmokeSummary() {
  return {
    totalCount: 0,
    attemptedCount: 0,
    successCount: 0,
    failureCount: 0,
    skippedCount: 0,
    successRate: 0,
  };
}

export function serializeLlmDraft(draft: LlmConfigDraft) {
  return normalizeLlmConfigInput({
    enabled: Boolean(draft.enabled),
    defaultModelKey: String(draft.defaultModelKey ?? "").trim(),
    providers: draft.providers.map((item) => ({
      key: String(item?.key ?? "").trim(),
      label: String(item?.label ?? "").trim(),
      enabled: Boolean(item?.enabled),
      baseUrl: String(item?.baseUrl ?? "").trim().replace(/\/+$/, ""),
      apiKey: String(item?.apiKey ?? "").trim(),
      timeoutMs: Number(String(item?.timeoutMs ?? "").trim() || "0"),
    })),
    models: draft.models.map((item) => ({
      key: String(item?.key ?? "").trim(),
      label: String(item?.label ?? "").trim(),
      kind: item?.kind,
      strategy: item?.strategy,
      routes: item.routes.map((route) => ({
        provider: String(route?.provider ?? "").trim(),
        providerModel: String(route?.providerModel ?? "").trim(),
        enabled: Boolean(route?.enabled),
        weight: Number(String(route?.weight ?? "").trim()),
      })),
    })),
  });
}

export function serializeLlmDraftForPreview(draft: LlmConfigDraft) {
  try {
    return serializeLlmDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft.enabled),
      defaultModelKey: String(draft.defaultModelKey ?? ""),
      providers: draft.providers,
      models: draft.models,
    };
  }
}

export function formatLlmConfigJson(config: LlmConfigDraft | LlmServiceConfig = createDefaultLlmConfig()) {
  return JSON.stringify(serializeLlmDraftForPreview(cloneLlmConfig(config)), null, 2);
}

export function getLlmDraftValidationError(draft: LlmConfigDraft) {
  try {
    serializeLlmDraft(draft);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : "LLM 配置校验失败。";
  }
}

export function parseLlmConfigText(rawText: string) {
  const parsed = parseLlmJsonObject(rawText);
  const config = normalizeLlmConfigInput(parsed);

  return {
    config,
    draft: cloneLlmConfig(config),
    normalizedText: JSON.stringify(config, null, 2),
  };
}

export function safeSerializeLlmDraft(draft: LlmConfigDraft) {
  try {
    return serializeLlmDraft(draft);
  } catch {
    return {
      enabled: Boolean(draft.enabled),
      defaultModelKey: String(draft.defaultModelKey ?? ""),
      providers: draft.providers,
      models: draft.models,
    };
  }
}

export function getModelRuntimeSnapshot(
  runtimeModels: LlmModelRuntimeStatus[] | undefined,
  modelKey: string,
) {
  return runtimeModels?.find((item) => item.key === modelKey) ?? null;
}

export function toRouteStrategyLabel(strategy: LlmRoutingStrategy) {
  return strategy === "fixed" ? "固定路由" : "自动路由";
}

export function toModelKindLabel(kind: LlmModelKind) {
  return kind === "embedding" ? "Embedding" : "Chat";
}

function assertUniqueValues(values: string[], message: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(message);
    }
    seen.add(value);
  }
}

function normalizeLlmConfigInput(input: unknown): LlmServiceConfig {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("LLM 配置根节点必须是 JSON object。");
  }

  const source = input as Record<string, unknown>;
  const providers = normalizeProviders(source.providers);
  const models = normalizeModels(source.models, providers);
  const defaultModelKey = optionalString(source.defaultModelKey);
  const config: LlmServiceConfig = {
    enabled: Boolean(source.enabled),
    defaultModelKey,
    providers,
    models,
  };

  if (!config.enabled) {
    if (config.defaultModelKey && !config.models.some((item) => item.key === config.defaultModelKey)) {
      throw new Error("defaultModelKey 必须引用现有模型。");
    }
    return config;
  }

  if (!config.providers.length) {
    throw new Error("启用 LLM 服务时至少需要一个供应商。");
  }

  if (!config.models.length) {
    throw new Error("启用 LLM 服务时至少需要一个模型。");
  }

  if (!config.defaultModelKey) {
    throw new Error("启用 LLM 服务时必须填写 defaultModelKey。");
  }

  const defaultModel = config.models.find((item) => item.key === config.defaultModelKey);
  if (!defaultModel) {
    throw new Error("defaultModelKey 必须引用现有模型。");
  }

  if (defaultModel.kind !== "chat") {
    throw new Error("defaultModelKey 必须引用 chat 类型模型。");
  }

  return config;
}

function normalizeProviders(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  const providers = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个供应商必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const key = normalizeProviderKey(source.key);
    const label = requireTrimmedString(source.label, `第 ${index + 1} 个供应商必须填写 label。`);
    const enabled = Boolean(source.enabled);
    const baseUrl = normalizeBaseUrl(source.baseUrl);
    const timeoutMs = normalizeTimeout(source.timeoutMs);
    const apiKey = optionalString(source.apiKey);

    if (!baseUrl) {
      throw new Error(`供应商 ${key} 必须填写 baseUrl。`);
    }

    if (enabled && !apiKey) {
      throw new Error(`供应商 ${key} 启用时必须填写 apiKey。`);
    }

    return {
      key,
      label,
      enabled,
      baseUrl,
      apiKey,
      timeoutMs,
    };
  });

  assertUniqueValues(
    providers.map((item) => item.key),
    "供应商 key 不允许重复。",
  );

  return providers;
}

function normalizeModels(value: unknown, providers: LlmServiceConfig["providers"]) {
  if (!Array.isArray(value)) {
    return [];
  }

  const providerKeys = new Set(providers.map((item) => item.key));
  const models = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`第 ${index + 1} 个模型必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const key = normalizeModelKey(source.key);
    const label = requireTrimmedString(source.label, `模型 ${key || `#${index + 1}`} 必须填写 label。`);
    const kind = normalizeKind(source.kind);
    const strategy = normalizeStrategy(source.strategy);
    const routes = normalizeRoutes(source.routes, key, providerKeys);

    return {
      key,
      label,
      kind,
      strategy,
      routes,
    };
  });

  assertUniqueValues(
    models.map((item) => item.key),
    "模型 key 不允许重复。",
  );

  return models;
}

function normalizeRoutes(value: unknown, modelKey: string, providerKeys: Set<string>) {
  if (!Array.isArray(value)) {
    throw new Error(`模型 ${modelKey} 的 routes 必须是数组。`);
  }

  if (!value.length) {
    throw new Error(`模型 ${modelKey} 至少要有一条 route。`);
  }

  const routes = value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`模型 ${modelKey} 的第 ${index + 1} 条 route 必须是 JSON object。`);
    }

    const source = item as Record<string, unknown>;
    const provider = normalizeProviderKey(source.provider);
    const providerModel = requireTrimmedString(
      source.providerModel,
      `模型 ${modelKey} 的第 ${index + 1} 条 route 必须填写 providerModel。`,
    );
    const enabled = Boolean(source.enabled);
    const weight = normalizeWeight(source.weight, modelKey, index + 1);

    if (!providerKeys.has(provider)) {
      throw new Error(`模型 ${modelKey} 的第 ${index + 1} 条 route 引用了不存在的供应商 ${provider}。`);
    }

    return {
      provider,
      providerModel,
      enabled,
      weight,
    };
  });

  const enabledRoutes = routes.filter((item) => item.enabled);
  if (enabledRoutes.length) {
    const totalWeight = enabledRoutes.reduce((sum, item) => sum + item.weight, 0);
    if (Math.abs(totalWeight - 100) > 0.01) {
      throw new Error(`模型 ${modelKey} 当前启用 route 的 weight 合计必须等于 100。`);
    }
  }

  return routes;
}

function normalizeProviderKey(value: unknown) {
  const normalized = requireTrimmedString(value, "Provider key 不能为空。");
  if (!PROVIDER_KEY_PATTERN.test(normalized)) {
    throw new Error(`供应商 key 格式不正确：${normalized}`);
  }
  return normalized;
}

function normalizeModelKey(value: unknown) {
  const normalized = requireTrimmedString(value, "Model key 不能为空。");
  if (!MODEL_KEY_PATTERN.test(normalized)) {
    throw new Error(`模型 key 格式不正确：${normalized}`);
  }
  return normalized;
}

function normalizeStrategy(value: unknown): LlmRoutingStrategy {
  const normalized = requireTrimmedString(value, "模型 strategy 不能为空。") as LlmRoutingStrategy;
  if (!VALID_ROUTING_STRATEGIES.has(normalized)) {
    throw new Error(`不支持的模型路由策略：${String(value)}`);
  }
  return normalized;
}

function normalizeKind(value: unknown): LlmModelKind {
  const normalized = optionalString(value);
  if (!normalized) {
    return DEFAULT_MODEL_KIND;
  }

  if (!VALID_MODEL_KINDS.has(normalized as LlmModelKind)) {
    throw new Error(`不支持的模型类型：${String(value)}`);
  }

  return normalized as LlmModelKind;
}

function normalizeWeight(value: unknown, modelKey: string, routeIndex: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 必须是 number。`);
  }

  if (value <= 0) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 必须大于 0。`);
  }

  const normalized = Math.round(value * WEIGHT_PRECISION) / WEIGHT_PRECISION;
  if (Math.abs(value - normalized) > 0.000001) {
    throw new Error(`模型 ${modelKey} 的第 ${routeIndex} 条 route weight 最多保留两位小数。`);
  }

  return normalized;
}

function normalizeBaseUrl(value: unknown) {
  return optionalString(value).replace(/\/+$/, "");
}

function normalizeTimeout(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_PROVIDER_TIMEOUT_MS;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("供应商 timeoutMs 必须是正数。");
  }

  return Math.round(value);
}

function requireTrimmedString(value: unknown, message: string) {
  const normalized = optionalString(value);
  if (!normalized) {
    throw new Error(message);
  }
  return normalized;
}

function optionalString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function parseLlmJsonObject(rawText: string) {
  let parsed: unknown;

  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    throw new Error(formatJsonParseError(rawText, error));
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("LLM 配置根节点必须是 JSON object。");
  }

  return parsed as Record<string, unknown>;
}

function formatJsonParseError(rawText: string, error: unknown) {
  const message = error instanceof Error ? error.message : "请输入合法的 JSON。";
  const positionMatch = /position\s+(\d+)/i.exec(message);
  if (!positionMatch) {
    return "请输入合法的 JSON。";
  }

  const position = Number(positionMatch[1]);
  if (!Number.isInteger(position) || position < 0) {
    return "请输入合法的 JSON。";
  }

  const { line, column } = getJsonLineColumn(rawText, position);
  return `JSON 语法错误：第 ${line} 行，第 ${column} 列。`;
}

function getJsonLineColumn(text: string, position: number) {
  const normalized = text.slice(0, position);
  const lines = normalized.split("\n");
  return {
    line: lines.length,
    column: lines[lines.length - 1]!.length + 1,
  };
}
