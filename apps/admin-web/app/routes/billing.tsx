import { Alert, Select, Space, Tabs } from "antd";
import { useEffect, useState } from "react";
import { BillingOrdersSection } from "../components/billing-orders-section";
import { BillingOverviewSection } from "../components/billing-overview-section";
import { BillingMembershipsSection } from "../components/billing-memberships-section";
import { billingAdminApi } from "../lib/billing-admin-api";
import { useBillingQuery } from "../lib/use-billing-query";
import { useAdminSession } from "../lib/admin-session";

export default function BillingRoute() {
  const [appId, setAppId] = useState("all");
  const { completeWorkspaceTransition } = useAdminSession();
  const apps = useBillingQuery(billingAdminApi.apps, "billing-apps");
  useEffect(() => { completeWorkspaceTransition(); }, [completeWorkspaceTransition]);
  const selected = apps.data?.find((app) => app.appId === appId);
  return <section className="stack">
    <header className="page-header"><div><h1>会员与支付</h1><p>Server 级只读管理，按应用隔离会员与支付数据。</p></div></header>
    <Space><span>应用</span><Select aria-label="支付应用筛选" loading={apps.loading} style={{ width: 260 }} value={appId} onChange={setAppId} options={[{ value: "all", label: "全部已接入应用" }, ...(apps.data ?? []).map((app) => ({ value: app.appId, label: `${app.appName} (${app.appId})${app.integrated ? "" : " · 未接入"}` }))]} /></Space>
    {apps.error ? <Alert type="error" message={apps.error} /> : null}
    {selected && !selected.integrated ? <Alert type="info" message="该应用尚未接入支付管理；不是零收入，也不共享其他应用的会员。" /> : apps.data ? <>
      {appId === "all" ? <Alert type="info" message={`已接入：${apps.data.filter((app) => app.integrated).map((app) => app.appName).join("、") || "暂无"}。未接入应用不计入概览。`} /> : null}
      <Tabs key={appId} destroyOnHidden items={[
        { key: "overview", label: "收入概览", children: <BillingOverviewSection appId={appId} /> },
        { key: "members", label: "会员", children: <BillingMembershipsSection appId={appId} /> },
        { key: "orders", label: "支付记录与事件", children: <BillingOrdersSection appId={appId} /> },
      ]} />
    </> : null}
  </section>;
}
