import { ApiOutlined, DeleteOutlined } from "@ant-design/icons";
import { Button, Input, Select, Switch, Tag } from "antd";

import { Field } from "./field";
import type { LlmProviderDraft, LlmRouteDraft } from "../lib/types";

export function LlmRouteCard({
  route,
  routeIndex,
  providers,
  onChange,
  onRemove,
}: {
  route: LlmRouteDraft;
  routeIndex: number;
  providers: LlmProviderDraft[];
  onChange: (key: keyof LlmRouteDraft, value: string | boolean) => void;
  onRemove: () => void;
}) {
  const providerLabel = providers.find((provider) => provider.key === route.provider)?.label || route.provider || "未选择供应商";
  const routeLabel = route.providerModel || "新路由";

  return (
    <article
      aria-label={`路由 ${routeIndex + 1}：${providerLabel} 到 ${routeLabel}`}
      className={`route-item ${route.enabled ? "" : "route-item--disabled"}`}
    >
      <header className="route-item-header">
        <div className="route-item-identity">
          <span className="route-item-icon" aria-hidden="true">
            <ApiOutlined />
          </span>
          <div>
            <div className="route-item-eyebrow">
              <span>路由 {String(routeIndex + 1).padStart(2, "0")}</span>
              <Tag color={route.enabled ? "success" : "default"} variant="filled">
                {route.enabled ? "已启用" : "已禁用"}
              </Tag>
            </div>
            <h4>
              <span>{providerLabel}</span>
              <span className="route-item-arrow" aria-hidden="true">→</span>
              <code>{routeLabel}</code>
            </h4>
          </div>
        </div>
        <div className="route-item-actions">
          <label className="route-enable-control">
            <span>启用</span>
            <Switch
              aria-label={`启用路由 ${routeLabel}`}
              checked={route.enabled}
              onChange={(value) => onChange("enabled", value)}
              size="small"
            />
          </label>
          <Button danger icon={<DeleteOutlined />} onClick={onRemove} size="small">
            删除
          </Button>
        </div>
      </header>

      <div className="route-item-fields">
        <Field label="Provider">
          <Select
            onChange={(value) => onChange("provider", value)}
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
            onChange={(event) => onChange("providerModel", event.target.value)}
            placeholder="qwen3.5-plus"
            value={route.providerModel}
          />
        </Field>
        <Field className="field--weight" hint="启用路由的权重和必须为 100" label="Weight">
          <Input
            onChange={(event) => onChange("weight", event.target.value)}
            value={route.weight}
          />
        </Field>
      </div>
    </article>
  );
}
