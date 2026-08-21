import { CompressOutlined, ExpandOutlined } from "@ant-design/icons";
import { Button } from "antd";

import { LlmModelCard, LlmProviderCard } from "./llm-config-cards";
import {
  createEmptyLlmModel,
  createEmptyLlmProvider,
  createEmptyLlmRoute,
  getModelRuntimeSnapshot,
} from "../lib/llm-config";
import type {
  AdminLlmServiceDocument,
  LlmConfigDraft,
  LlmModelDraft,
  LlmProviderDraft,
  LlmRouteDraft,
} from "../lib/types";

type DraftChangeHandler = (updater: (current: LlmConfigDraft) => LlmConfigDraft) => void;

export function LlmProvidersEditor({
  draft,
  onDraftChange,
}: {
  draft: LlmConfigDraft;
  onDraftChange: DraftChangeHandler;
}) {
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

export function LlmModelsEditor({
  allCollapsed,
  collapsedModels,
  document,
  draft,
  onDraftChange,
  onToggleAllModels,
  onToggleModel,
}: {
  allCollapsed: boolean;
  collapsedModels: Set<string>;
  document: AdminLlmServiceDocument | null;
  draft: LlmConfigDraft;
  onDraftChange: DraftChangeHandler;
  onToggleAllModels: () => void;
  onToggleModel: (modelKey: string) => void;
}) {
  return (
    <section className="stack">
      <div className="model-list-toolbar">
        <span>共 {draft.models.length} 个模型</span>
        <Button
          icon={allCollapsed ? <ExpandOutlined /> : <CompressOutlined />}
          onClick={onToggleAllModels}
          size="small"
        >
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
  onDraftChange: DraftChangeHandler,
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

    return { ...current, providers: nextProviders, models: nextModels };
  });
}

function updateModel(
  onDraftChange: DraftChangeHandler,
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

    return { ...current, defaultModelKey: nextDefaultModelKey, models: nextModels };
  });
}

function updateRoute(
  onDraftChange: DraftChangeHandler,
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
