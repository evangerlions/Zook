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
  const runnableModels = useMemo(
    () => (config?.models ?? []).filter((model) =>
      model.routes.some((route) => isRunnableRoute(config, route)),
    ),
    [config],
  );
  const selectedModel = runnableModels.find((item) => item.key === selectedModelKey)
    ?? runnableModels.find((item) => item.key === config?.defaultModelKey)
    ?? runnableModels[0];
  const runnableRoutes = selectedModel?.routes.filter(
    (route) => isRunnableRoute(config, route),
  ) ?? [];
  const selectedRoute = runnableRoutes.find(
    (route) => route.provider === selectedProvider,
  ) ?? runnableRoutes[0];

  const modelOptions = runnableModels.map((model) => ({
    label: `${model.label} (${model.key})`,
    value: model.key,
  }));
  const providerOptions = runnableRoutes.map((route) => {
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
    const nextModel = runnableModels.find((item) => item.key === modelKey);
    setSelectedProvider(
      nextModel?.routes.find((route) => isRunnableRoute(config, route))
        ?.provider ?? "",
    );
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
    <section className="llm-smoke-runner" aria-label="冒烟测试执行设置">
      <div className="llm-smoke-runner-heading">
        <div>
          <span className="llm-smoke-eyebrow">测试范围</span>
          <h3>选择要验证的路由</h3>
        </div>
        <span className="llm-smoke-live-note">将调用真实上游</span>
      </div>

      <Segmented
        aria-label="冒烟测试模式"
        className="llm-smoke-mode-toggle"
        onChange={(value) => handleModeChange(value as LlmSmokeTestMode)}
        options={SMOKE_MODE_OPTIONS}
        value={mode}
      />

      {mode === "route" ? (
        <div className="llm-smoke-route-grid">
          <label>
            <span>模型</span>
            <Select
              aria-label="选择冒烟测试模型"
              onChange={handleModelChange}
              options={modelOptions}
              value={selectedModel?.key}
            />
          </label>
          <label>
            <span>供应商 route</span>
            <Select
              aria-label="选择冒烟测试供应商"
              onChange={setSelectedProvider}
              options={providerOptions}
              value={selectedRoute?.provider}
            />
          </label>
        </div>
      ) : (
        <div className="llm-smoke-mode-note">
          <strong>覆盖全部可执行路由</strong>
          <span>只请求已启用模型 route；未配置或已停用的组合不会请求，也不会出现在结果中。</span>
        </div>
      )}

      <div className="llm-smoke-runner-footer">
        <span>同一时间窗口内仅允许执行一次，冷却时间为 10 秒。</span>
        <Button
          className="llm-smoke-run-button"
          disabled={running || (mode === "route" && !canRunRoute)}
          loading={running}
          onClick={handleRun}
          type="primary"
        >
          {running ? "执行中..." : mode === "route" ? "运行指定路由" : "运行全量测试"}
        </Button>
      </div>
    </section>
  );
}

function isRunnableRoute(
  config: LlmServiceConfig | null,
  route: LlmServiceConfig["models"][number]["routes"][number],
): boolean {
  return route.enabled && Boolean(
    config?.providers.find(
      (provider) => provider.key === route.provider && provider.enabled,
    ),
  );
}
