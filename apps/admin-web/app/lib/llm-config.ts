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
  const providers = draft.providers.map((item, index) => {
    const key = String(item?.key ?? "").trim();
    const label = String(item?.label ?? "").trim();
    const baseUrl = String(item?.baseUrl ?? "").trim().replace(/\/+$/, "");
    const apiKey = String(item?.apiKey ?? "").trim();
    const timeoutMs = Number(String(item?.timeoutMs ?? "").trim() || "0");

    if (!key || !label || !baseUrl) {
      throw new Error(`请完整填写第 ${index + 1} 个供应商。`);
    }

    if (!/^[a-z0-9][a-z0-9_-]*$/.test(key)) {
      throw new Error(`第 ${index + 1} 个供应商 key 格式不正确。`);
    }

    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error(`第 ${index + 1} 个供应商 timeoutMs 必须是正数。`);
    }

    if (item.enabled && !apiKey) {
      throw new Error(`第 ${index + 1} 个供应商启用时必须填写 apiKey。`);
    }

    return {
      key,
      label,
      enabled: Boolean(item.enabled),
      baseUrl,
      apiKey,
      timeoutMs: Math.round(timeoutMs),
    };
  });

  assertUniqueValues(
    providers.map((item) => item.key),
    "供应商 key 不允许重复。",
  );

  const providerKeys = new Set(providers.map((item) => item.key));
  const models = draft.models.map((item, index) => {
    const key = String(item?.key ?? "").trim();
    const label = String(item?.label ?? "").trim();
    const kind: LlmModelKind = item?.kind === "embedding" ? "embedding" : "chat";
    const strategy = item?.strategy === "fixed" ? "fixed" : "auto";

    if (!key || !label) {
      throw new Error(`请完整填写第 ${index + 1} 个模型。`);
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(key)) {
      throw new Error(`第 ${index + 1} 个模型 key 格式不正确。`);
    }

    const routes = item.routes.map((route, routeIndex) => {
      const provider = String(route?.provider ?? "").trim();
      const providerModel = String(route?.providerModel ?? "").trim();
      const weight = Number(String(route?.weight ?? "").trim());

      if (!provider || !providerModel) {
        throw new Error(`请完整填写模型 ${key} 的第 ${routeIndex + 1} 条 route。`);
      }

      if (!providerKeys.has(provider)) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route 引用了不存在的供应商 ${provider}。`);
      }

      if (!Number.isFinite(weight) || weight <= 0) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route weight 必须是正数。`);
      }

      if (Math.abs(weight - Math.round(weight * 100) / 100) > 0.000001) {
        throw new Error(`模型 ${key} 的第 ${routeIndex + 1} 条 route weight 最多保留两位小数。`);
      }

      return {
        provider,
        providerModel,
        enabled: Boolean(route.enabled),
        weight: Math.round(weight * 100) / 100,
      };
    });

    if (!routes.length) {
      throw new Error(`模型 ${key} 至少要有一条 route。`);
    }

    const enabledRoutes = routes.filter((route) => route.enabled);
    if (enabledRoutes.length) {
      const totalWeight = enabledRoutes.reduce((sum, route) => sum + route.weight, 0);
      if (Math.abs(totalWeight - 100) > 0.01) {
        throw new Error(`模型 ${key} 当前启用 route 的 weight 合计必须等于 100。`);
      }
    }

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

  const defaultModelKey = String(draft.defaultModelKey ?? "").trim();
  if (draft.enabled) {
    if (!defaultModelKey) {
      throw new Error("启用 LLM 服务时，必须选择默认模型。");
    }
    const defaultModel = models.find((item) => item.key === defaultModelKey);
    if (!defaultModel) {
      throw new Error("默认模型必须引用现有模型。");
    }
    if (defaultModel.kind !== "chat") {
      throw new Error("默认模型必须引用 chat 类型模型。");
    }
  }

  return {
    enabled: Boolean(draft.enabled),
    defaultModelKey,
    providers,
    models,
  };
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
