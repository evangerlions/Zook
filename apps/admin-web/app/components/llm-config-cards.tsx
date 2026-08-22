import { DatabaseOutlined, DeleteOutlined, DownOutlined, RightOutlined, RobotOutlined } from "@ant-design/icons";
import { Button, Input, Select, Tag } from "antd";

import { Field } from "./field";
import { LlmRouteCard } from "./llm-route-card";
import {
  getModelRuntimeSnapshot,
  toModelKindLabel,
  toRouteStrategyLabel,
} from "../lib/llm-config";
import type { LlmModelDraft, LlmProviderDraft, LlmRouteDraft } from "../lib/types";

export function LlmProviderCard({
  provider,
  onChange,
  onRemove,
}: {
  provider: LlmProviderDraft;
  onChange: (key: keyof LlmProviderDraft, value: string | boolean) => void;
  onRemove: () => void;
}) {
  return (
    <article className={`config-item ${provider.enabled ? "" : "config-item--disabled"}`}>
      <div className="config-item-header">
        <div className="config-item-title">
          <h3>{provider.label || provider.key || "新供应商"}</h3>
          <Tag color={provider.enabled ? "success" : "default"} variant="filled">
            {provider.enabled ? "已启用" : "已禁用"}
          </Tag>
        </div>
        <div className="config-item-actions">
          <Button
            onClick={() => onChange("enabled", !provider.enabled)}
            size="small"
          >
            {provider.enabled ? "禁用" : "启用"}
          </Button>
          <Button danger onClick={onRemove} size="small">
            删除
          </Button>
        </div>
      </div>

      <div className="config-form-grid">
        <Field hint="唯一标识" label="Key">
          <Input
            onChange={(event) => onChange("key", event.target.value)}
            placeholder="bailian"
            value={provider.key}
          />
        </Field>
        <Field hint="显示名称" label="Label">
          <Input
            onChange={(event) => onChange("label", event.target.value)}
            placeholder="百炼"
            value={provider.label}
          />
        </Field>
        <Field className="field--full" label="Base URL">
          <Input
            onChange={(event) => onChange("baseUrl", event.target.value)}
            placeholder="https://dashscope.aliyuncs.com/compatible-mode/v1"
            value={provider.baseUrl}
          />
        </Field>
        <Field className="field--full" label="API Key">
          <Input.Password
            onChange={(event) => onChange("apiKey", event.target.value)}
            placeholder="sk-..."
            value={provider.apiKey}
          />
        </Field>
        <Field hint="请求超时" label="Timeout (ms)">
          <Input
            onChange={(event) => onChange("timeoutMs", event.target.value)}
            value={provider.timeoutMs}
          />
        </Field>
      </div>
    </article>
  );
}

export function LlmModelCard({
  model,
  providers,
  runtimeSnapshot,
  collapsed,
  onToggleCollapse,
  onChange,
  onRemove,
  onAddRoute,
  onRouteChange,
  onRouteRemove,
}: {
  model: LlmModelDraft;
  providers: LlmProviderDraft[];
  runtimeSnapshot: ReturnType<typeof getModelRuntimeSnapshot>;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onChange: (key: keyof LlmModelDraft, value: string) => void;
  onRemove: () => void;
  onAddRoute: () => void;
  onRouteChange: (routeIndex: number, key: keyof LlmRouteDraft, value: string | boolean) => void;
  onRouteRemove: (routeIndex: number) => void;
}) {
  const toneClass = getModelToneClass(model.key);

  return (
    <article className={`config-item model-card ${toneClass}${collapsed ? " model-card--collapsed" : ""}`}>
      <div className="config-item-header model-card-header">
        <button
          aria-expanded={!collapsed}
          className="model-card-toggle"
          onClick={onToggleCollapse}
          type="button"
        >
          <span className="model-card-chevron" aria-hidden="true">
            {collapsed ? <RightOutlined /> : <DownOutlined />}
          </span>
          <span className="model-card-icon" aria-hidden="true">
            {model.kind === "embedding" ? <DatabaseOutlined /> : <RobotOutlined />}
          </span>
          <span className="model-card-heading">
            <span className="model-card-eyebrow">模型</span>
            <span className="model-card-name">{model.label || model.key || "新模型"}</span>
            <span className="model-card-metadata">
              <code className="model-key-badge">{model.key || "未设置 Key"}</code>
              <Tag variant="filled">{toModelKindLabel(model.kind)}</Tag>
              <Tag variant="filled">{toRouteStrategyLabel(model.strategy)}</Tag>
              <Tag color={model.routes.length > 0 ? "processing" : "warning"} variant="filled">
                {model.routes.length} 条路由
              </Tag>
            </span>
          </span>
        </button>
        <div className="config-item-actions" onClick={(event) => event.stopPropagation()}>
          <Button danger icon={<DeleteOutlined />} onClick={onRemove} size="small">
            删除模型
          </Button>
        </div>
      </div>

      {collapsed ? null : (
        <>
          <div className="config-form-grid">
            <Field hint="唯一标识" label="Key">
              <Input
                onChange={(event) => onChange("key", event.target.value)}
                placeholder="qwen3.5-plus"
                value={model.key}
              />
            </Field>
            <Field hint="显示名称" label="Label">
              <Input
                onChange={(event) => onChange("label", event.target.value)}
                placeholder="Qwen 3.5 Plus"
                value={model.label}
              />
            </Field>
            <Field hint="chat 用于对话，embedding 用于向量化" label="Kind">
              <Select
                onChange={(value) => onChange("kind", value)}
                options={[
                  { label: "chat", value: "chat" },
                  { label: "embedding", value: "embedding" },
                ]}
                value={model.kind}
              />
            </Field>
            <Field hint="auto 自动路由，fixed 固定路由" label="Strategy">
              <Select
                onChange={(value) => onChange("strategy", value)}
                options={[
                  { label: "auto", value: "auto" },
                  { label: "fixed", value: "fixed" },
                ]}
                value={model.strategy}
              />
            </Field>
          </div>

          <section className="route-list">
            <div className="route-list-header">
              <div>
                <span className="route-list-eyebrow">ROUTING</span>
                <h4>路由配置</h4>
                <p>每条路由独立配置供应商、模型和流量权重。</p>
              </div>
              <Button onClick={onAddRoute} size="small">
                + 添加路由
              </Button>
            </div>

            {model.routes.length === 0 ? (
              <div className="empty-state" style={{ padding: "16px", fontSize: "0.9rem" }}>
                还没有配置路由，点击上方按钮添加。
              </div>
            ) : (
              model.routes.map((route, routeIndex) => (
                <LlmRouteCard
                  key={`${route.provider}-${route.providerModel}-${routeIndex}`}
                  onChange={(key, value) => onRouteChange(routeIndex, key, value)}
                  onRemove={() => onRouteRemove(routeIndex)}
                  providers={providers}
                  route={route}
                  routeIndex={routeIndex}
                />
              ))
            )}
          </section>
          {runtimeSnapshot ? null : null}
        </>
      )}
    </article>
  );
}

const MODEL_TONE_CLASSES = ["model-card--blue", "model-card--violet", "model-card--teal", "model-card--amber"];

function getModelToneClass(modelKey: string) {
  const hash = [...modelKey].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return MODEL_TONE_CLASSES[hash % MODEL_TONE_CLASSES.length];
}
