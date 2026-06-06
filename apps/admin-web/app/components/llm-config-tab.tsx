import { CopyOutlined } from "@ant-design/icons";
import { Button, Collapse, Select, Segmented } from "antd";

import { Field, ToggleField } from "./field";
import { JsonEditor } from "./json-editor";
import { JsonPreview } from "./json-preview";
import { LlmModelCard, LlmProviderCard } from "./llm-config-cards";
import { RevisionHistoryDock } from "./revision-history-dock";
import { RevisionList } from "./revision-list";
import {
  createEmptyLlmModel,
  createEmptyLlmProvider,
  createEmptyLlmRoute,
  getModelRuntimeSnapshot,
  toModelKindLabel,
} from "../lib/llm-config";
import type {
  AdminLlmServiceDocument,
  LlmConfigDraft,
  LlmModelDraft,
  LlmProviderDraft,
  LlmRouteDraft,
} from "../lib/types";

const LLM_CONFIG_MODE_OPTIONS: Array<{ label: string; value: "form" | "raw" }> = [
  { label: "表单", value: "form" },
  { label: "RAW JSON", value: "raw" },
];

const CONFIG_SUB_TABS: Array<{ label: string; value: "providers" | "models" }> = [
  { label: "供应商", value: "providers" },
  { label: "模型与路由", value: "models" },
];

interface LlmConfigTabProps {
  activeConfigError: string;
  allCollapsed: boolean;
  collapsedModels: Set<string>;
  configMode: "form" | "raw";
  configSubTab: "providers" | "models";
  document: AdminLlmServiceDocument | null;
  draft: LlmConfigDraft;
  draftValidationError: string;
  historyExpanded: boolean;
  loadingConfig: boolean;
  onBackToLatest: () => void;
  onConfigModeChange: (value: "form" | "raw") => void;
  onConfigSubTabChange: (value: "providers" | "models") => void;
  onCopyPreview: () => void;
  onDraftChange: (updater: (current: LlmConfigDraft) => LlmConfigDraft) => void;
  onRawValueChange: (value: string) => void;
  onRefresh: () => void;
  onRequestSave: () => void;
  onRestoreRevision: (revision: number) => void;
  onSelectRevision: (revision: number) => void;
  onToggleAllModels: () => void;
  onToggleHistory: () => void;
  onToggleModel: (modelKey: string) => void;
  previewValue: unknown;
  rawValidationError: string;
  rawValue: string;
  restoringRevision: number | null;
  saving: boolean;
}

export function LlmConfigTab({
  activeConfigError,
  allCollapsed,
  collapsedModels,
  configMode,
  configSubTab,
  document,
  draft,
  draftValidationError,
  historyExpanded,
  loadingConfig,
  onBackToLatest,
  onConfigModeChange,
  onConfigSubTabChange,
  onCopyPreview,
  onDraftChange,
  onRawValueChange,
  onRefresh,
  onRequestSave,
  onRestoreRevision,
  onSelectRevision,
  onToggleAllModels,
  onToggleHistory,
  onToggleModel,
  previewValue,
  rawValidationError,
  rawValue,
  restoringRevision,
  saving,
}: LlmConfigTabProps) {
  const chatModelOptions = draft.models.filter((item) => item.key && item.kind === "chat");

  return (
    <div className="stack">
      <section className="surface-card collapse-card">
        <Collapse
          className="config-collapse"
          defaultActiveKey={[]}
          items={[
            {
              key: "structure-preview",
              label: (
                <span>
                  结构预览
                  {activeConfigError ? null : (
                    <Button
                      icon={<CopyOutlined />}
                      onClick={(event) => {
                        event.stopPropagation();
                        onCopyPreview();
                      }}
                      size="small"
                      style={{ marginLeft: 8 }}
                      type="text"
                    />
                  )}
                </span>
              ),
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
                <Button onClick={onBackToLatest}>
                  回到最新
                </Button>
              ) : null}
              <Button onClick={onRefresh}>
                刷新
              </Button>
            </div>
          </div>

          {loadingConfig ? <p className="meta-text">正在加载 LLM 配置...</p> : null}

          <div className="stack">
            <div className="config-mode-toolbar">
              <Segmented
                className="range-segmented"
                onChange={(value) => onConfigModeChange(value as "form" | "raw")}
                options={LLM_CONFIG_MODE_OPTIONS}
                value={configMode}
              />
              <span className="meta-chip">{activeConfigError ? "校验待修正" : "校验通过"}</span>
            </div>

            {configMode === "form" ? (
              <LlmFormConfigEditor
                allCollapsed={allCollapsed}
                chatModelOptions={chatModelOptions}
                collapsedModels={collapsedModels}
                configSubTab={configSubTab}
                document={document}
                draft={draft}
                draftValidationError={draftValidationError}
                onConfigSubTabChange={onConfigSubTabChange}
                onDraftChange={onDraftChange}
                onToggleAllModels={onToggleAllModels}
                onToggleModel={onToggleModel}
              />
            ) : (
              <label className="field">
                <span className="field-label">RAW JSON</span>
                <JsonEditor
                  onChange={onRawValueChange}
                  readOnly={loadingConfig || saving}
                  value={rawValue}
                />
                <small className="field-hint">
                  直接编辑标准 JSON。`timeoutMs`、`weight` 等数值字段请保持为 number，不要写成字符串。
                </small>
                {rawValidationError ? (
                  <small className="form-error">{rawValidationError}</small>
                ) : (
                  <small className="field-hint">保存前会按当前规则重新标准化，避免把结构写乱。</small>
                )}
              </label>
            )}

            <div className="button-row">
              <Button
                disabled={saving || loadingConfig || Boolean(activeConfigError)}
                onClick={onRequestSave}
                type="primary"
              >
                保存 LLM 配置
              </Button>
            </div>
          </div>
        </section>

        <RevisionHistoryDock
          expanded={historyExpanded}
          onToggle={onToggleHistory}
        >
          <RevisionList
            activeRevision={document?.revision}
            compact
            latestRevision={document?.revisions?.[0]?.revision}
            loadingRevision={restoringRevision}
            onRestore={onRestoreRevision}
            onSelect={onSelectRevision}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>
    </div>
  );
}

function LlmFormConfigEditor({
  allCollapsed,
  chatModelOptions,
  collapsedModels,
  configSubTab,
  document,
  draft,
  draftValidationError,
  onConfigSubTabChange,
  onDraftChange,
  onToggleAllModels,
  onToggleModel,
}: Pick<LlmConfigTabProps, "allCollapsed" | "collapsedModels" | "configSubTab" | "document" | "draft" | "draftValidationError" | "onConfigSubTabChange" | "onDraftChange" | "onToggleAllModels" | "onToggleModel"> & {
  chatModelOptions: LlmModelDraft[];
}) {
  return (
    <>
      <ToggleField
        checked={draft.enabled}
        hint="关闭后不会影响历史版本，但不会再参与默认路由。"
        label="启用 LLM 服务"
        onChange={(value) => onDraftChange((current) => ({ ...current, enabled: value }))}
      />

      <Field hint="启用状态下必须选择一个存在的模型。" label="默认模型">
        <Select
          onChange={(value) => onDraftChange((current) => ({ ...current, defaultModelKey: value }))}
          options={[
            { label: "请选择", value: "" },
            ...chatModelOptions.map((item) => ({
              label: `${item.label || item.key} (${toModelKindLabel(item.kind)})`,
              value: item.key,
            })),
          ]}
          value={draft.defaultModelKey}
        />
      </Field>

      <div className="config-sub-tabs">
        {CONFIG_SUB_TABS.map((item) => (
          <button
            className={`config-sub-tab ${configSubTab === item.value ? "is-active" : ""}`}
            key={item.value}
            onClick={() => onConfigSubTabChange(item.value)}
            type="button"
          >
            {item.label}
            <span className="config-sub-tab-count">
              {item.value === "providers" ? draft.providers.length : draft.models.length}
            </span>
          </button>
        ))}
      </div>

      {configSubTab === "providers" ? (
        <LlmProvidersEditor draft={draft} onDraftChange={onDraftChange} />
      ) : (
        <LlmModelsEditor
          allCollapsed={allCollapsed}
          collapsedModels={collapsedModels}
          document={document}
          draft={draft}
          onDraftChange={onDraftChange}
          onToggleAllModels={onToggleAllModels}
          onToggleModel={onToggleModel}
        />
      )}

      {draftValidationError ? <p className="form-error">{draftValidationError}</p> : null}
    </>
  );
}

function LlmProvidersEditor({
  draft,
  onDraftChange,
}: Pick<LlmConfigTabProps, "draft" | "onDraftChange">) {
  return (
    <section className="stack">
      <div className="provider-list">
        {draft.providers.map((provider, index) => (
          <LlmProviderCard
            key={`${provider.key || "provider"}-${index}`}
            onChange={(key, value) => updateProvider(onDraftChange, index, key, value)}
            onRemove={() => onDraftChange((current) => ({
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

      <button
        className="config-add-button"
        onClick={() => onDraftChange((current) => ({ ...current, providers: [...current.providers, createEmptyLlmProvider()] }))}
        type="button"
      >
        + 添加供应商
      </button>
    </section>
  );
}

function LlmModelsEditor({
  allCollapsed,
  collapsedModels,
  document,
  draft,
  onDraftChange,
  onToggleAllModels,
  onToggleModel,
}: Pick<LlmConfigTabProps, "allCollapsed" | "collapsedModels" | "document" | "draft" | "onDraftChange" | "onToggleAllModels" | "onToggleModel">) {
  return (
    <section className="stack">
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "8px" }}>
        <Button onClick={onToggleAllModels} size="small">
          {allCollapsed ? "全部展开" : "全部折叠"}
        </Button>
      </div>
      <div className="model-list">
        {draft.models.map((model, modelIndex) => (
          <LlmModelCard
            collapsed={collapsedModels.has(model.key || "")}
            key={`${model.key || "model"}-${modelIndex}`}
            model={model}
            onAddRoute={() => onDraftChange((current) => ({
              ...current,
              models: current.models.map((item, index) => (
                index === modelIndex
                  ? { ...item, routes: [...item.routes, createEmptyLlmRoute(current.providers[0]?.key ?? "")] }
                  : item
              )),
            }))}
            onChange={(key, value) => updateModel(onDraftChange, modelIndex, key, value)}
            onRemove={() => onDraftChange((current) => ({
              ...current,
              defaultModelKey: current.defaultModelKey === model.key ? "" : current.defaultModelKey,
              models: current.models.filter((_, index) => index !== modelIndex),
            }))}
            onRouteChange={(routeIndex, key, value) => updateRoute(onDraftChange, modelIndex, routeIndex, key, value)}
            onRouteRemove={(routeIndex) => onDraftChange((current) => ({
              ...current,
              models: current.models.map((item, index) => (
                index === modelIndex
                  ? { ...item, routes: item.routes.filter((_, currentRouteIndex) => currentRouteIndex !== routeIndex) }
                  : item
              )),
            }))}
            onToggleCollapse={() => onToggleModel(model.key || "")}
            providers={draft.providers}
            runtimeSnapshot={getModelRuntimeSnapshot(document?.runtime.models, model.key)}
          />
        ))}
      </div>

      <button
        className="config-add-button"
        onClick={() => onDraftChange((current) => ({ ...current, models: [...current.models, createEmptyLlmModel()] }))}
        type="button"
      >
        + 添加模型
      </button>
    </section>
  );
}

function updateProvider(
  onDraftChange: LlmConfigTabProps["onDraftChange"],
  index: number,
  key: keyof LlmProviderDraft,
  value: string | boolean,
) {
  onDraftChange((current) => {
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

function updateModel(
  onDraftChange: LlmConfigTabProps["onDraftChange"],
  index: number,
  key: keyof LlmModelDraft,
  value: string,
) {
  onDraftChange((current) => {
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

function updateRoute(
  onDraftChange: LlmConfigTabProps["onDraftChange"],
  modelIndex: number,
  routeIndex: number,
  key: keyof LlmRouteDraft,
  value: string | boolean,
) {
  onDraftChange((current) => ({
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
