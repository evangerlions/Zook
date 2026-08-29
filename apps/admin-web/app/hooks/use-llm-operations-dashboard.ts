import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { adminApi, ApiError } from "../lib/admin-api";
import { formatApiError } from "../lib/format";
import type {
  AdminLlmMetricsDocument,
  LlmMetricsOperation,
  LlmMetricsRange,
} from "../lib/types";

const AUTO_REFRESH_MS = 60_000;

export function useLlmOperationsDashboard() {
  const [range, setRange] = useState<LlmMetricsRange>("48h");
  const [operation, setOperation] = useState<"" | LlmMetricsOperation>("");
  const [provider, setProvider] = useState("");
  const [providerModel, setProviderModel] = useState("");
  const [metrics, setMetrics] = useState<AdminLlmMetricsDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [filterNotice, setFilterNotice] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const requestSequence = useRef(0);

  const refresh = useCallback(async (background = false) => {
    const sequence = ++requestSequence.current;
    background ? setRefreshing(true) : setLoading(true);
    try {
      const next = await adminApi.getLlmMetrics(range, {
        provider: provider || undefined,
        providerModel: providerModel || undefined,
        operation: operation || undefined,
      });
      if (sequence !== requestSequence.current) return;
      setMetrics(next);
      setError("");
    } catch (nextError) {
      if (sequence !== requestSequence.current) return;
      if (provider && nextError instanceof ApiError && /Unknown provider/i.test(nextError.message)) {
        setProvider("");
        setError("");
        setFilterNotice(`Provider ${provider} 已从配置移除，筛选已恢复为全部 Provider。`);
        return;
      }
      setError(formatApiError(nextError));
    } finally {
      if (sequence === requestSequence.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [operation, provider, providerModel, range]);

  useEffect(() => {
    void refresh(false);
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) return;
    const timer = window.setInterval(() => void refresh(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [autoRefresh, refresh]);

  const providerOptions = metrics?.providers ?? [];
  const providerModelOptions = useMemo(() => {
    const values = new Set<string>();
    for (const model of metrics?.runtime.models ?? []) {
      for (const route of model.routes) values.add(route.providerModel);
    }
    for (const model of metrics?.models.items ?? []) values.add(model.providerModel);
    return [...values].sort((left, right) => left.localeCompare(right));
  }, [metrics]);

  useEffect(() => {
    if (loading || !providerModel || providerModelOptions.includes(providerModel)) return;
    setProviderModel("");
    setFilterNotice(`Provider Model ${providerModel} 已从配置移除，筛选已恢复为全部 Model。`);
  }, [loading, providerModel, providerModelOptions]);

  return {
    autoRefresh,
    clearFilterNotice: () => setFilterNotice(""),
    error,
    filterNotice,
    loading,
    metrics,
    operation,
    pendingFilters: loading && metrics !== null,
    provider,
    providerModel,
    providerModelOptions,
    providerOptions,
    range,
    refreshing,
    refresh: () => refresh(true),
    selectIntersection(nextProvider: string, nextProviderModel: string, nextOperation?: LlmMetricsOperation) {
      setProvider(nextProvider);
      setProviderModel(nextProviderModel);
      if (nextOperation) setOperation(nextOperation);
    },
    setAutoRefresh,
    setOperation,
    setProvider,
    setProviderModel,
    setRange,
  };
}
