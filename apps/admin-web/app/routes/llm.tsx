import { Button, Collapse, Input, Segmented, Select, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Field, ToggleField } from "../components/field";
import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { MetricCard } from "../components/metric-card";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatNumber, formatTimestamp, makeNotice } from "../lib/format";
import {
  cloneLlmConfig,
  createDefaultLlmConfig,
  createEmptyLlmModel,
  createEmptyLlmProvider,
  createEmptyLlmRoute,
  createEmptyLlmSmokeSummary,
  createEmptyLlmSummary,
  formatLlmConfigJson,
  getLlmDraftValidationError,
  getModelRuntimeSnapshot,
  normalizeLlmDocument,
  parseLlmConfigText,
  safeSerializeLlmDraft,
  serializeLlmDraft,
  serializeLlmDraftForPreview,
  toModelKindLabel,
  toRouteStrategyLabel,
} from "../lib/llm-config";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  AdminLlmSmokeTestItem,
  LlmConfigDraft,
  LlmMetricsRange,
  LlmModelDraft,
  LlmProviderDraft,
  LlmRouteDraft,
} from "../lib/types";

const RANGE_OPTIONS: LlmMetricsRange[] = ["24h", "7d", "30d"];
const LLM_TAB_OPTIONS: Array<{ label: string; value: "monitor" | "config" | "smoke" }> = [
  { label: "监控", value: "monitor" },
  { label: "冒烟测试", value: "smoke" },
  { label: "配置", value: "config" },
];
const LLM_CONFIG_MODE_OPTIONS: Array<{ label: string; value: "form" | "raw" }> = [
  { label: "表单", value: "form" },
  { label: "RAW JSON", value: "raw" },
];

export default function LlmRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [tab, setTab] = useState<"monitor" | "config" | "smoke">("monitor");
  const [configMode, setConfigMode] = useState<"form" | "raw">("form");
  const [document, setDocument] = useState<AdminLlmServiceDocument | null>(null);
  const [draft, setDraft] = useState<LlmConfigDraft>(createDefaultLlmConfig());
  const [originalDraft, setOriginalDraft] = useState<LlmConfigDraft>(createDefaultLlmConfig());
  const [rawValue, setRawValue] = useState(() => formatLlmConfigJson(createDefaultLlmConfig()));
  const [metrics, setMetrics] = useState<AdminLlmMetricsDocument | null>(null);
  const [modelMetrics, setModelMetrics] = useState<AdminLlmModelMetricsDocument | null>(null);
  const [smokeDocument, setSmokeDocument] = useState<AdminLlmSmokeTestDocument | null>(null);
  const [range, setRange] = useState<LlmMetricsRange>("24h");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [runningSmokeTest, setRunningSmokeTest] = useState(false);
  const [desc, setDesc] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const draftValidationError = useMemo(() => getLlmDraftValidationError(draft), [draft]);
  const rawValidation = useMemo(() => {
    try {
      return {
        ...parseLlmConfigText(rawValue),
        error: "",
      };
    } catch (error) {
      return {
        config: null,
        draft: null,
        normalizedText: "",
        error: formatApiError(error),
      };
    }
  }, [rawValue]);
  const draftSnapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const rawDraftSnapshot = useMemo(
    () => (rawValidation.draft ? JSON.stringify(rawValidation.draft) : ""),
    [rawValidation.draft],
  );
  const activeConfigError = configMode === "raw" ? rawValidation.error : draftValidationError;

  function applyConfigDocument(payload: AdminLlmServiceDocument | null, preserveSelectedModel = true) {
    const nextDraft = cloneLlmConfig(payload?.config);
    const availableModelKeys = payload?.config.models.map((item) => item.key) ?? [];
    const fallbackModelKey = payload?.config.defaultModelKey || payload?.config.models[0]?.key || "";

    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setRawValue(formatLlmConfigJson(payload?.config ?? nextDraft));
    setDesc("");
    setSelectedModelKey((current) => (
      preserveSelectedModel && current && availableModelKeys.includes(current) ? current : fallbackModelKey
    ));
  }

  async function loadConfig() {
    setLoadingConfig(true);
    try {
      applyConfigDocument(normalizeLlmDocument(await adminApi.getLlmService()));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function loadMetrics(nextRange: LlmMetricsRange) {
    setLoadingMetrics(true);
    try {
      const payload = await adminApi.getLlmMetrics(nextRange);
      setMetrics(payload);
      const nextModelKey = payload.models.some((item) => item.modelKey === selectedModelKey)
        ? selectedModelKey
        : payload.models[0]?.modelKey || "";
      setSelectedModelKey(nextModelKey);
      if (nextModelKey) {
        const detail = await adminApi.getLlmModelMetrics(nextModelKey, nextRange);
        setModelMetrics(detail);
      } else {
        setModelMetrics(null);
      }
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    void Promise.all([loadConfig(), loadMetrics(range)]);
  }, []);

  useEffect(() => {
    void loadMetrics(range);
  }, [range]);

  useEffect(() => {
    if (configMode !== "raw" || rawValidation.error || !rawValidation.draft || rawDraftSnapshot === draftSnapshot) {
      return;
    }

    setDraft(rawValidation.draft);
  }, [configMode, draftSnapshot, rawDraftSnapshot, rawValidation.draft, rawValidation.error]);

  useEffect(() => {
    if (configMode === "raw") {
      return;
    }

    setRawValue(formatLlmConfigJson(draft));
  }, [configMode, draft]);

  const previewValue = useMemo(
    () => (configMode === "raw" ? rawValidation.config : serializeLlmDraftForPreview(draft)),
    [configMode, draft, rawValidation.config],
  );
  const summary = metrics?.summary ?? createEmptyLlmSummary();
  const smokeSummary = smokeDocument?.summary ?? createEmptyLlmSmokeSummary();
  const chatModelOptions = draft.models.filter((item) => item.key && item.kind === "chat");
  const smokeColumns = useMemo(
    () => [
      {
        title: "厂商",
        key: "provider",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <strong>{item.providerLabel || item.provider}</strong>
            <span className="mono">{item.provider}</span>
          </div>
        ),
      },
      {
        title: "模型",
        key: "model",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <strong>{item.modelLabel || item.modelKey}</strong>
            <span className="mono">{item.modelKey}</span>
          </div>
        ),
      },
      {
        title: "厂商模型",
        dataIndex: "providerModel",
        key: "providerModel",
        render: (value: string, item: AdminLlmSmokeTestItem) => (
          item.configured && value ? <span className="mono">{value}</span> : <span className="meta-text">未配置</span>
        ),
      },
      {
        title: "类型",
        dataIndex: "modelKind",
        key: "modelKind",
        render: (value: AdminLlmSmokeTestItem["modelKind"]) => toModelKindLabel(value),
      },
      {
        title: "结果",
        dataIndex: "status",
        key: "status",
        render: (value: AdminLlmSmokeTestItem["status"]) => (
          <Tag bordered={false} color={getSmokeStatusColor(value)}>{getSmokeStatusLabel(value)}</Tag>
        ),
      },
      {
        title: "耗时",
        dataIndex: "latencyMs",
        key: "latencyMs",
        align: "right" as const,
        render: (value: number | undefined, item: AdminLlmSmokeTestItem) => (
          item.status === "skipped" || value == null ? <span className="meta-text">-</span> : `${value} ms`
        ),
      },
      {
        title: "结果摘要",
        key: "message",
        render: (_: unknown, item: AdminLlmSmokeTestItem) => (
          <div className="table-primary-cell table-primary-cell--stack">
            <span>{item.message}</span>
            {item.responsePreview ? <span className="table-smoke-preview">{item.responsePreview}</span> : null}
          </div>
        ),
      },
    ],
    [],
  );

  function updateProvider(index: number, key: keyof LlmProviderDraft, value: string | boolean) {
    setDraft((current) => {
      const previousKey = current.providers[index]?.key ?? "";
      const nextProviders = current.providers.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } as LlmProviderDraft : item
      ));
      const nextModels = key === "key" && previousKey !== value
        ? current.models.map((model) => ({
            ...model,
            routes: model.routes.map((route) => (
              route.provider === previousKey ? { ...route, provider: String(value) } : route
            )),
          }))
        : current.models;

      return {
        ...current,
        providers: nextProviders,
        models: nextModels,
      };
    });
  }

  function updateModel(index: number, key: keyof LlmModelDraft, value: string) {
    setDraft((current) => {
      const previousKey = current.models[index]?.key ?? "";
      const nextModels = current.models.map((item, itemIndex) => (
        itemIndex === index ? { ...item, [key]: value } as LlmModelDraft : item
      ));
      const nextDefaultModelKey = key === "key" && current.defaultModelKey === previousKey
        ? value
        : current.defaultModelKey;
      return {
        ...current,
        models: nextModels,
        defaultModelKey: nextDefaultModelKey,
      };
    });
  }

  function updateRoute(modelIndex: number, routeIndex: number, key: keyof LlmRouteDraft, value: string | boolean) {
    setDraft((current) => ({
      ...current,
      models: current.models.map((model, currentModelIndex) => (
        currentModelIndex === modelIndex
          ? {
              ...model,
              routes: model.routes.map((route, currentRouteIndex) => (
                currentRouteIndex === routeIndex ? { ...route, [key]: value } as LlmRouteDraft : route
              )),
            }
          : model
      )),
    }));
  }

  function openSaveModal() {
    if (activeConfigError) {
      return;
    }
    setSaveModalOpen(true);
  }

  async function handleConfirmSave() {
    setSaving(true);
    clearNotice();
    try {
      const nextConfig = configMode === "raw" ? parseLlmConfigText(rawValue).config : serializeLlmDraft(draft);
      const payload = normalizeLlmDocument(
        await adminApi.updateLlmService({
          ...nextConfig,
          desc: desc.trim() || undefined,
        }),
      );
      applyConfigDocument(payload);
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "LLM 配置已保存。"));
      await loadMetrics(range);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoadingConfig(true);
    try {
      applyConfigDocument(normalizeLlmDocument(await adminApi.getLlmServiceRevision(revision)), false);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function handleRestoreRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = normalizeLlmDocument(await adminApi.restoreLlmService(revision));
      applyConfigDocument(payload, false);
      await loadMetrics(range);
      setNotice(makeNotice("success", `已恢复到版本 R${revision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleRunSmokeTest() {
    setRunningSmokeTest(true);
    clearNotice();
    try {
      const payload = await adminApi.runLlmSmokeTest();
      setSmokeDocument(payload);
      setNotice(
        makeNotice(
          "success",
          `冒烟测试完成：成功 ${payload.summary.successCount}，失败 ${payload.summary.failureCount}，跳过 ${payload.summary.skippedCount}。`,
        ),
      );
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRunningSmokeTest(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>LLM</h1>
          <p>统一管理 `common.llm_service` 的供应商、模型路由、监控指标和冒烟测试。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
        </div>
      </header>

      <div className="tab-row">
        <Segmented
          className="page-segmented"
          onChange={(value) => setTab(value as "monitor" | "config" | "smoke")}
          options={LLM_TAB_OPTIONS}
          value={tab}
        />
      </div>

      {tab === "monitor" ? (
        <div className="stack">
          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>整体指标</h2>
                <p>按小时聚合的全局监控，用来快速判断当前路由稳定性。</p>
              </div>
              <Segmented
                className="range-segmented"
                onChange={(value) => setRange(value as LlmMetricsRange)}
                options={RANGE_OPTIONS}
                value={range}
              />
            </div>

            {loadingMetrics ? <p className="meta-text">正在加载监控指标...</p> : null}

            <div className="metric-grid">
              <MetricCard hint="最近范围内的总请求次数" label="请求量" value={formatNumber(summary.requestCount)} />
              <MetricCard hint="成功次数 / 请求次数" label="成功率" value={`${summary.successRate}%`} />
              <MetricCard hint="从请求发出到收到首块内容" label="平均首字节" value={`${summary.avgFirstByteLatencyMs} ms`} />
              <MetricCard hint="从请求发出到完整结束" label="平均总耗时" value={`${summary.avgTotalLatencyMs} ms`} />
            </div>
          </section>

          <div className="page-grid page-grid--wide">
            <section className="surface-card">
              <div className="card-header">
                <div>
                  <h2>模型对比</h2>
                  <p>选择一个模型，查看它在当前时间范围内的路由表现。</p>
                </div>
                <Select
                  className="inline-input"
                  onChange={(nextModelKey) => {
                    setSelectedModelKey(nextModelKey);
                    if (nextModelKey) {
                      void adminApi.getLlmModelMetrics(nextModelKey, range).then(setModelMetrics).catch((error) => {
                        setNotice(makeNotice("error", formatApiError(error)));
                      });
                    }
                  }}
                  options={[
                    { label: "请选择模型", value: "" },
                    ...((metrics?.models ?? []).map((item) => ({
                      label: item.label,
                      value: item.modelKey,
                    }))),
                  ]}
                  size="large"
                  value={selectedModelKey}
                />
              </div>

              {(metrics?.models ?? []).length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>模型</th>
                        <th>请求量</th>
                        <th>成功率</th>
                        <th>平均首字节</th>
                        <th>平均总耗时</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics?.models.map((item) => (
                        <tr key={item.modelKey}>
                          <td>{item.label}</td>
                          <td>{formatNumber(item.summary.requestCount)}</td>
                          <td>{item.summary.successRate}%</td>
                          <td>{item.summary.avgFirstByteLatencyMs} ms</td>
                          <td>{item.summary.avgTotalLatencyMs} ms</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty-state">当前范围内还没有模型调用数据。</div>
              )}
            </section>

            <aside className="panel-stack">
              <section className="side-card">
                <div className="card-header">
                  <div>
                    <h2>所选模型明细</h2>
                    <p>按 provider / providerModel 展示 route 聚合结果。</p>
                  </div>
                </div>
                {modelMetrics ? (
                  <div className="stack">
                    <div className="metric-grid">
                      <MetricCard label="请求量" value={formatNumber(modelMetrics.summary.requestCount)} />
                      <MetricCard label="成功率" value={`${modelMetrics.summary.successRate}%`} />
                    </div>
                    <div className="table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Provider</th>
                            <th>Model</th>
                            <th>请求量</th>
                            <th>成功率</th>
                            <th>平均总耗时</th>
                          </tr>
                        </thead>
                        <tbody>
                          {modelMetrics.routes.map((item) => (
                            <tr key={`${item.provider}-${item.providerModel}`}>
                              <td>{item.provider}</td>
                              <td className="mono">{item.providerModel}</td>
                              <td>{formatNumber(item.summary.requestCount)}</td>
                              <td>{item.summary.successRate}%</td>
                              <td>{item.summary.avgTotalLatencyMs} ms</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">选择一个模型后，这里会显示 route 级别明细。</div>
                )}
              </section>

            </aside>
          </div>
        </div>
      ) : tab === "smoke" ? (
        <div className="stack">
          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>冒烟测试</h2>
                <p>按当前生效配置遍历厂商 × 模型矩阵，验证 provider 连通性、响应耗时和基本返回结果。</p>
              </div>
              <div className="button-row">
                <span className="meta-chip">冷却 {smokeDocument?.cooldownSeconds ?? 10}s</span>
                <span className="meta-chip">{smokeDocument ? formatTimestamp(smokeDocument.executedAt) : "尚未执行"}</span>
                <Button disabled={runningSmokeTest} loading={runningSmokeTest} onClick={() => void handleRunSmokeTest()} size="large" type="primary">
                  {runningSmokeTest ? "执行中..." : "运行冒烟测试"}
                </Button>
              </div>
            </div>

            <div className="metric-grid">
              <MetricCard label="总矩阵" value={String(smokeSummary.totalCount)} />
              <MetricCard label="成功" value={String(smokeSummary.successCount)} />
              <MetricCard label="失败" value={String(smokeSummary.failureCount)} />
              <MetricCard label="跳过" value={String(smokeSummary.skippedCount)} />
            </div>
          </section>

          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>执行结果</h2>
                <p>主表格展示每个厂商 × 模型的状态、耗时和结果摘要，原始返回放在下面折叠区里。</p>
              </div>
            </div>

            {smokeDocument?.items.length ? (
              <Table<AdminLlmSmokeTestItem>
                className="smoke-table"
                columns={smokeColumns}
                dataSource={smokeDocument.items}
                pagination={false}
                rowClassName={(item) => `smoke-table-row smoke-table-row--${item.status}`}
                rowKey={(item) => `${item.provider}-${item.modelKey}-${item.providerModel || "missing"}`}
                scroll={{ x: 1080 }}
              />
            ) : (
              <div className="empty-state">运行一次冒烟测试后，这里会展示完整矩阵结果。</div>
            )}
          </section>

          <section className="surface-card collapse-card">
            <Collapse
              className="config-collapse"
              defaultActiveKey={[]}
              items={[
                {
                  key: "smoke-json",
                  label: "原始 JSON 结构",
                  children: smokeDocument ? (
                    <JsonPreview value={smokeDocument} />
                  ) : (
                    <div className="empty-state">运行后才会生成原始冒烟测试 JSON。</div>
                  ),
                },
              ]}
            />
          </section>
        </div>
      ) : (
        <div className="stack">
          <section className="surface-card collapse-card">
            <Collapse
              className="config-collapse"
              defaultActiveKey={[]}
              items={[
                {
                  key: "structure-preview",
                  label: "结构预览",
                  children: activeConfigError ? (
                    <div className="empty-state">当前配置还没有通过校验，暂时无法生成结构预览。</div>
                  ) : (
                    <JsonPreview value={previewValue} />
                  ),
                },
              ]}
            />
          </section>

          <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
            <section className="surface-card">
              <div className="card-header">
                <div>
                  <h2>路由配置</h2>
                  <p>维护供应商、模型和 route 三层结构。启用中的 route 权重和必须等于 100。</p>
                </div>
                <div className="button-row">
                  {!document?.isLatest ? (
                    <Button onClick={() => void loadConfig()} size="large">
                      回到最新
                    </Button>
                  ) : null}
                  <Button onClick={() => void loadConfig()} size="large">
                    刷新
                  </Button>
                </div>
              </div>

              {loadingConfig ? <p className="meta-text">正在加载 LLM 配置...</p> : null}

              <div className="stack">
                <div className="config-mode-toolbar">
                  <Segmented
                    className="range-segmented"
                    onChange={(value) => setConfigMode(value as "form" | "raw")}
                    options={LLM_CONFIG_MODE_OPTIONS}
                    value={configMode}
                  />
                  <span className="meta-chip">{activeConfigError ? "校验待修正" : "校验通过"}</span>
                </div>

                {configMode === "form" ? (
                  <>
                    <ToggleField
                      checked={draft.enabled}
                      hint="关闭后不会影响历史版本，但不会再参与默认路由。"
                      label="启用 LLM 服务"
                      onChange={(value) => setDraft((current) => ({ ...current, enabled: value }))}
                    />

                    <Field hint="启用状态下必须选择一个存在的模型。" label="默认模型">
                      <Select
                        onChange={(value) => setDraft((current) => ({ ...current, defaultModelKey: value }))}
                        options={[
                          { label: "请选择", value: "" },
                          ...chatModelOptions.map((item) => ({
                            label: `${item.label || item.key} (${toModelKindLabel(item.kind)})`,
                            value: item.key,
                          })),
                        ]}
                        size="large"
                        value={draft.defaultModelKey}
                      />
                    </Field>

                    <section className="stack">
                      <div className="card-header">
                        <div>
                          <h3>供应商</h3>
                          <p>配置 provider 连接信息。修改 key 时会同步更新已引用的 routes。</p>
                        </div>
                        <Button
                          onClick={() => setDraft((current) => ({ ...current, providers: [...current.providers, createEmptyLlmProvider()] }))}
                          size="large"
                        >
                          添加供应商
                        </Button>
                      </div>

                      <div className="provider-list">
                        {draft.providers.map((provider, index) => (
                          <ProviderCard
                            key={`${provider.key || "provider"}-${index}`}
                            onChange={(key, value) => updateProvider(index, key, value)}
                            onRemove={() => setDraft((current) => ({
                              ...current,
                              providers: current.providers.filter((_, itemIndex) => itemIndex !== index),
                              models: current.models.map((model) => ({
                                ...model,
                                routes: model.routes.filter((route) => route.provider !== provider.key),
                              })),
                            }))}
                            provider={provider}
                          />
                        ))}
                      </div>
                    </section>

                    <section className="stack">
                      <div className="card-header">
                        <div>
                          <h3>模型与 Routes</h3>
                          <p>每个模型都可以拥有多条 route，并根据策略决定流量分发方式。</p>
                        </div>
                        <Button
                          onClick={() => setDraft((current) => ({ ...current, models: [...current.models, createEmptyLlmModel()] }))}
                          size="large"
                        >
                          添加模型
                        </Button>
                      </div>

                      <div className="model-list">
                        {draft.models.map((model, modelIndex) => (
                          <ModelCard
                            key={`${model.key || "model"}-${modelIndex}`}
                            model={model}
                            onAddRoute={() => setDraft((current) => ({
                              ...current,
                              models: current.models.map((item, index) => (
                                index === modelIndex
                                  ? {
                                      ...item,
                                      routes: [...item.routes, createEmptyLlmRoute(current.providers[0]?.key ?? "")],
                                    }
                                  : item
                              )),
                            }))}
                            onChange={(key, value) => updateModel(modelIndex, key, value)}
                            onRemove={() => setDraft((current) => ({
                              ...current,
                              defaultModelKey: current.defaultModelKey === model.key ? "" : current.defaultModelKey,
                              models: current.models.filter((_, index) => index !== modelIndex),
                            }))}
                            onRouteChange={(routeIndex, key, value) => updateRoute(modelIndex, routeIndex, key, value)}
                            onRouteRemove={(routeIndex) => setDraft((current) => ({
                              ...current,
                              models: current.models.map((item, index) => (
                                index === modelIndex
                                  ? { ...item, routes: item.routes.filter((_, currentRouteIndex) => currentRouteIndex !== routeIndex) }
                                  : item
                              )),
                            }))}
                            providers={draft.providers}
                            runtimeSnapshot={getModelRuntimeSnapshot(document?.runtime.models, model.key)}
                          />
                        ))}
                      </div>
                    </section>

                    {draftValidationError ? <p className="form-error">{draftValidationError}</p> : null}
                  </>
                ) : (
                  <label className="field">
                    <span className="field-label">RAW JSON</span>
                    <JsonEditor
                      onChange={setRawValue}
                      readOnly={loadingConfig || saving}
                      value={rawValue}
                    />
                    <small className="field-hint">
                      直接编辑标准 JSON。`timeoutMs`、`weight` 等数值字段请保持为 number，不要写成字符串。
                    </small>
                    {rawValidation.error ? (
                      <small className="form-error">{rawValidation.error}</small>
                    ) : (
                      <small className="field-hint">保存前会按当前规则重新标准化，避免把结构写乱。</small>
                    )}
                  </label>
                )}

                <div className="button-row">
                  <Button
                    disabled={saving || loadingConfig || Boolean(activeConfigError)}
                    onClick={openSaveModal}
                    size="large"
                    type="primary"
                  >
                    保存 LLM 配置
                  </Button>
                </div>
              </div>
            </section>

            <RevisionHistoryDock
              expanded={historyExpanded}
              onToggle={() => setHistoryExpanded((current) => !current)}
            >
              <RevisionList
                activeRevision={document?.revision}
                compact
                loadingRevision={restoringRevision}
                onRestore={(revision) => void handleRestoreRevision(revision)}
                onSelect={(revision) => void handleViewRevision(revision)}
                revisions={document?.revisions ?? []}
              />
            </RevisionHistoryDock>
          </div>
        </div>
      )}

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：新增模型路由或调整权重"
        loading={saving}
        newValue={configMode === "raw" ? rawValidation.normalizedText : JSON.stringify(safeSerializeLlmDraft(draft), null, 2)}
        oldValue={JSON.stringify(safeSerializeLlmDraft(originalDraft), null, 2)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存 LLM 配置"
      />
    </section>
  );
}

function getSmokeStatusLabel(status: AdminLlmSmokeTestItem["status"]) {
  if (status === "success") {
    return "成功";
  }

  if (status === "failed") {
    return "失败";
  }

  return "跳过";
}

function getSmokeStatusColor(status: AdminLlmSmokeTestItem["status"]) {
  if (status === "success") {
    return "success";
  }

  if (status === "failed") {
    return "error";
  }

  return "default";
}

function ProviderCard({
  provider,
  onChange,
  onRemove,
}: {
  provider: LlmProviderDraft;
  onChange: (key: keyof LlmProviderDraft, value: string | boolean) => void;
  onRemove: () => void;
}) {
  return (
    <article className="provider-card">
      <div className="card-header">
        <div>
          <h3>{provider.label || provider.key || "新供应商"}</h3>
          <p className="mono">{provider.baseUrl || "尚未填写 baseUrl"}</p>
        </div>
        <Button danger onClick={onRemove} size="large">
          删除
        </Button>
      </div>

      <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
        <Field label="Key">
          <Input onChange={(event) => onChange("key", event.target.value)} size="large" value={provider.key} />
        </Field>
        <Field label="Label">
          <Input onChange={(event) => onChange("label", event.target.value)} size="large" value={provider.label} />
        </Field>
        <Field label="Base URL">
          <Input onChange={(event) => onChange("baseUrl", event.target.value)} size="large" value={provider.baseUrl} />
        </Field>
        <Field label="API Key">
          <Input.Password onChange={(event) => onChange("apiKey", event.target.value)} size="large" value={provider.apiKey} />
        </Field>
        <Field label="Timeout (ms)">
          <Input onChange={(event) => onChange("timeoutMs", event.target.value)} size="large" value={provider.timeoutMs} />
        </Field>
      </div>

      <ToggleField checked={provider.enabled} label="启用供应商" onChange={(value) => onChange("enabled", value)} />
    </article>
  );
}

function ModelCard({
  model,
  providers,
  runtimeSnapshot,
  onChange,
  onRemove,
  onAddRoute,
  onRouteChange,
  onRouteRemove,
}: {
  model: LlmModelDraft;
  providers: LlmProviderDraft[];
  runtimeSnapshot: ReturnType<typeof getModelRuntimeSnapshot>;
  onChange: (key: keyof LlmModelDraft, value: string) => void;
  onRemove: () => void;
  onAddRoute: () => void;
  onRouteChange: (routeIndex: number, key: keyof LlmRouteDraft, value: string | boolean) => void;
  onRouteRemove: (routeIndex: number) => void;
}) {
  return (
    <article className="model-card">
      <div className="card-header">
        <div>
          <h3>{model.label || model.key || "新模型"}</h3>
          <p>{toModelKindLabel(model.kind)} · {toRouteStrategyLabel(model.strategy)}</p>
        </div>
        <div className="button-row">
          <Button onClick={onAddRoute} size="large">
            添加 Route
          </Button>
          <Button danger onClick={onRemove} size="large">
            删除模型
          </Button>
        </div>
      </div>

      <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
        <Field label="Key">
          <Input onChange={(event) => onChange("key", event.target.value)} size="large" value={model.key} />
        </Field>
        <Field label="Label">
          <Input onChange={(event) => onChange("label", event.target.value)} size="large" value={model.label} />
        </Field>
        <Field hint="chat 用于对话生成，embedding 用于向量化。" label="Kind">
          <Select
            onChange={(value) => onChange("kind", value)}
            options={[
              { label: "chat", value: "chat" },
              { label: "embedding", value: "embedding" },
            ]}
            size="large"
            value={model.kind}
          />
        </Field>
        <Field label="Strategy">
          <Select
            onChange={(value) => onChange("strategy", value)}
            options={[
              { label: "auto", value: "auto" },
              { label: "fixed", value: "fixed" },
            ]}
            size="large"
            value={model.strategy}
          />
        </Field>
      </div>

      <div className="route-list">
        {model.routes.map((route, routeIndex) => (
          <article className="route-card" key={`${route.provider}-${route.providerModel}-${routeIndex}`}>
            <div className="card-header">
              <div>
                <h3>{route.providerModel || "新 Route"}</h3>
                <p>{runtimeSnapshot?.routes[routeIndex]?.healthScore != null ? `健康分 ${runtimeSnapshot.routes[routeIndex]!.healthScore}` : "尚无运行时数据"}</p>
              </div>
              <Button danger onClick={() => onRouteRemove(routeIndex)} size="large">
                删除 Route
              </Button>
            </div>

            <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
              <Field label="Provider">
                <Select
                  onChange={(value) => onRouteChange(routeIndex, "provider", value)}
                  options={[
                    { label: "请选择", value: "" },
                    ...providers.map((item) => ({
                      label: item.label || item.key,
                      value: item.key,
                    })),
                  ]}
                  size="large"
                  value={route.provider}
                />
              </Field>
              <Field label="Provider Model">
                <Input onChange={(event) => onRouteChange(routeIndex, "providerModel", event.target.value)} size="large" value={route.providerModel} />
              </Field>
              <Field label="Weight">
                <Input onChange={(event) => onRouteChange(routeIndex, "weight", event.target.value)} size="large" value={route.weight} />
              </Field>
              <ToggleField checked={route.enabled} label="启用 Route" onChange={(value) => onRouteChange(routeIndex, "enabled", value)} />
            </div>
          </article>
        ))}
      </div>
    </article>
  );
}
