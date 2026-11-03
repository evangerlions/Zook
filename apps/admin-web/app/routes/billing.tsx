import { Alert, Tabs } from "antd";
import { useEffect, useState } from "react";
import { BillingOrdersSection } from "../components/billing-orders-section";
import { BillingOverviewSection } from "../components/billing-overview-section";
import { BillingMembershipsSection } from "../components/billing-memberships-section";
import { BillingScopeFilter } from "../components/billing-scope-filter";
import { billingAdminApi, type BillingMember } from "../lib/billing-admin-api";
import { useBillingQuery } from "../lib/use-billing-query";
import { useAdminSession } from "../lib/admin-session";
import { loadBillingEnvironment, saveBillingEnvironment, type BillingEnvironment } from "../lib/billing-preferences";

export default function BillingRoute() {
  const [appId, setAppId] = useState("ai_novel");
  const [environment, setEnvironment] = useState<BillingEnvironment>(loadBillingEnvironment);
  const [activeTab, setActiveTab] = useState("overview");
  const [orderUserId, setOrderUserId] = useState<string>();
  function changeApp(value: string) {
    setAppId(value);
    setOrderUserId(undefined);
    setActiveTab("overview");
  }
  function openMemberPayments(member: BillingMember) {
    setAppId(member.appId);
    setOrderUserId(member.userId);
    setActiveTab("orders");
  }
  function changeTab(value: string) {
    setOrderUserId(undefined);
    setActiveTab(value);
  }
  function changeEnvironment(value: BillingEnvironment) {
    setOrderUserId(undefined);
    saveBillingEnvironment(value);
    setEnvironment(value);
  }
  const { completeWorkspaceTransition } = useAdminSession();
  const apps = useBillingQuery(billingAdminApi.apps, "billing-apps");
  useEffect(() => { completeWorkspaceTransition(); }, [completeWorkspaceTransition]);
  const selected = apps.data?.find((app) => app.appId === appId);
  return <section className="stack billing-page">
    <header className="page-header"><h1>会员与支付</h1></header>
    <BillingScopeFilter appId={appId} apps={apps.data ?? []} loading={apps.loading} environment={environment} onAppChange={changeApp} onEnvironmentChange={changeEnvironment} />
    {apps.error ? <Alert type="error" message={apps.error} /> : null}
    {selected && !selected.integrated ? <Alert type="info" message="该应用尚未接入支付管理；不是零收入，也不共享其他应用的会员。" /> : apps.data ? <>
      {appId === "all" ? <Alert type="info" message={`已接入：${apps.data.filter((app) => app.integrated).map((app) => app.appName).join("、") || "暂无"}。未接入应用不计入概览。`} /> : null}
      <Tabs key={appId} activeKey={activeTab} onChange={changeTab} destroyOnHidden items={[
        { key: "overview", label: "收入概览", children: <BillingOverviewSection appId={appId} environment={environment} /> },
        { key: "members", label: "会员", children: <BillingMembershipsSection key={`${appId}:${environment}`} appId={appId} environment={environment} onOpenPayments={openMemberPayments} /> },
        { key: "orders", label: "支付记录与事件", children: <BillingOrdersSection key={`${appId}:${environment}:${orderUserId ?? ""}`} appId={appId} environment={environment} initialUserId={orderUserId} /> },
      ]} />
    </> : null}
  </section>;
}
