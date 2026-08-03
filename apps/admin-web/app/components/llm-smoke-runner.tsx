import { Button, Segmented, Select } from "antd";
import { useMemo, useState } from "react";

import type {
  AdminLlmSmokeTestRunRequest,
  LlmServiceConfig,
  LlmSmokeTestMode,
} from "../lib/types";

interface LlmSmokeRunnerProps {
  config: LlmServiceConfig | null;
  onRun: (input: AdminLlmSmokeTestRunRequest) => void;
  running: boolean;
}

const SMOKE_MODE_OPTIONS: Array<{ label: string; value: LlmSmokeTestMode }> = [
  { label: "全量矩阵", value: "matrix" },
  { label: "指定路由", value: "route" },
];

export function LlmSmokeRunner({ config, onRun, running }: LlmSmokeRunnerProps) {
  const [mode, setMode] = useState<LlmSmokeTestMode>("matrix");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [selectedProvider, setSelectedProvider] = useState("");
  const selectedModel = useMemo(
    () => config?.models.find((item) => item.key === selectedModelKey)
      ?? config?.models.find((item) => item.key === config.defaultModelKey)
      ?? config?.models[0],
    [config, selectedModelKey],
  );
  const selectedRoute = selectedModel?.routes.find(
    (route) => route.provider === selectedProvider,
  ) ?? selectedModel?.routes[0];

  const modelOptions = (config?.models ?? []).map((model) => ({
    label: `${model.label} (${model.key})`,
    value: model.key,
  }));
  const providerOptions = (selectedModel?.routes ?? []).map((route) => {
    const provider = config?.providers.find((item) => item.key === route.provider);
    return {
      label: `${provider?.label ?? route.provider} · ${route.providerModel}`,
      value: route.provider,
    };
  });
  const canRunRoute = Boolean(selectedModel && selectedRoute);

  function handleModeChange(nextMode: LlmSmokeTestMode) {
    setMode(nextMode);
  }

  function handleModelChange(modelKey: string) {
    setSelectedModelKey(modelKey);
    const nextModel = config?.models.find((item) => item.key === modelKey);
    setSelectedProvider(nextModel?.routes[0]?.provider ?? "");
  }

  function handleRun() {
    if (mode === "matrix") {
      onRun({ mode });
      return;
    }

    if (!selectedModel || !selectedRoute) {
      return;
    }

    onRun({
      mode,
      modelKey: selectedModel.key,
      provider: selectedRoute.provider,
    });
  }

  return (
    <div className="stack">
      <Segmented
        aria-label="冒烟测试模式"
        className="range-segmented"
        onChange={(value) => handleModeChange(value as LlmSmokeTestMode)}
        options={SMOKE_MODE_OPTIONS}
        value={mode}
      />

      {mode === "route" ? (
        <div className="inline-row">
          <Select
            aria-label="选择冒烟测试模型"
            onChange={handleModelChange}
            options={modelOptions}
            value={selectedModel?.key}
          />
          <Select
            aria-label="选择冒烟测试供应商"
            onChange={setSelectedProvider}
            options={providerOptions}
            value={selectedRoute?.provider}
          />
        </div>
      ) : (
        <p className="meta-text">全量矩阵会遍历每个模型与供应商的配置组合。</p>
      )}

      <Button
        disabled={running || (mode === "route" && !canRunRoute)}
        loading={running}
        onClick={handleRun}
        type="primary"
      >
        {running ? "执行中..." : mode === "route" ? "运行指定路由冒烟测试" : "运行全量冒烟测试"}
      </Button>
    </div>
  );
}
