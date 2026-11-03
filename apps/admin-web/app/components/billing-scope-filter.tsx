import { Select, Space } from "antd";
import { useState } from "react";
import { BILLING_TERMS } from "../lib/billing-terms";
import type { BillingApp } from "../lib/billing-admin-api";
import type { BillingEnvironment } from "../lib/billing-preferences";

type Props = {
  appId: string;
  apps: BillingApp[];
  loading: boolean;
  environment: BillingEnvironment;
  onAppChange: (value: string) => void;
  onEnvironmentChange: (value: BillingEnvironment) => void;
};

export function BillingScopeFilter({ appId, apps, loading, environment, onAppChange, onEnvironmentChange }: Props) {
  const [expanded, setExpanded] = useState(true);
  const appOptions = [{ value: "all", label: "全部已接入应用" }, ...apps.map((app) => ({
    value: app.appId,
    label: `${app.appName} (${app.appId})${app.integrated ? "" : " · 未接入"}`,
  }))];
  const appLabel = appOptions.find((option) => option.value === appId)?.label ?? appId;
  const environmentLabel = BILLING_TERMS.environment.options.find((option) => option.value === environment)?.label;

  return <div className="billing-scope-filter">
    <button type="button" className="billing-scope-toggle" aria-expanded={expanded} aria-controls="billing-scope-selectors" onClick={() => setExpanded(!expanded)}>
      <span>应用</span><span aria-hidden="true">{expanded ? "▾" : "▸"}</span>
      {!expanded && <span className="billing-scope-summary">{appLabel} · {environmentLabel}</span>}
    </button>
    {expanded && <Space id="billing-scope-selectors" wrap>
      <Select aria-label="支付应用筛选" loading={loading} style={{ width: 260 }} value={appId} onChange={onAppChange} options={appOptions} />
      <Select aria-label={BILLING_TERMS.environment.label} value={environment} onChange={onEnvironmentChange} style={{ width: 160 }} options={BILLING_TERMS.environment.options} />
    </Space>}
  </div>;
}
