import { DownOutlined, RightOutlined } from "@ant-design/icons";
import { Button, Input, Select, Switch, Tag } from "antd";

import { Field } from "./field";
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
          <Tag bordered={false} color={provider.enabled ? "success" : "default"}>
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
  return (
    <article className="config-item">
      <div
        className="config-item-header"
        onClick={onToggleCollapse}
        style={{ cursor: "pointer", marginBottom: collapsed ? 0 : undefined, borderBottom: collapsed ? "none" : undefined }}
      >
        <div className="config-item-title">
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            {collapsed ? <RightOutlined style={{ fontSize: 12 }} /> : <DownOutlined style={{ fontSize: 12 }} />}
            <h3>{model.label || model.key || "新模型"}</h3>
          </span>
          <span className="config-item-meta">
            {toModelKindLabel(model.kind)} · {toRouteStrategyLabel(model.strategy)} · {model.routes.length} 路由
          </span>
        </div>
        <div className="config-item-actions" onClick={(event) => event.stopPropagation()}>
          <Button danger onClick={onRemove} size="small">
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

          <div className="route-list" style={{ marginTop: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <h4 style={{ margin: 0, fontSize: "0.95rem", fontWeight: 600 }}>路由配置</h4>
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
                <div
                  className={`route-item ${route.enabled ? "" : "route-item--disabled"}`}
                  key={`${route.provider}-${route.providerModel}-${routeIndex}`}
                >
                  <div className="route-item-header">
                    <h4>
                      {route.providerModel || "新路由"}
                      {!route.enabled && <span style={{ color: "var(--text-soft)", fontWeight: 400 }}> (已禁用)</span>}
                    </h4>
                    <Button danger onClick={() => onRouteRemove(routeIndex)} size="small">
                      删除
                    </Button>
                  </div>
                  <div className="route-item-fields">
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
                        value={route.provider}
                      />
                    </Field>
                    <Field label="Provider Model">
                      <Input
                        onChange={(event) => onRouteChange(routeIndex, "providerModel", event.target.value)}
                        placeholder="qwen3.5-plus"
                        value={route.providerModel}
                      />
                    </Field>
                    <Field className="field--weight" label="Weight">
                      <Input
                        onChange={(event) => onRouteChange(routeIndex, "weight", event.target.value)}
                        value={route.weight}
                      />
                    </Field>
                    <div className="toggle-inline">
                      <span className="toggle-inline-label">启用</span>
                      <Switch
                        checked={route.enabled}
                        onChange={(value) => onRouteChange(routeIndex, "enabled", value)}
                        size="small"
                      />
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
          {runtimeSnapshot ? null : null}
        </>
      )}
    </article>
  );
}
