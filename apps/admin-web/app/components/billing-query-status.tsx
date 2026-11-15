import { Tag } from "antd";
import type { Account } from "../lib/billing-accounts";
export function BillingQueryStatus({ account: a }: { account: Account }) {
  if (a.mode === "manual" && !a.sample) return <>需登录查询</>;
  if (!a.sample) return <>{a.credentialConfigured ? "等待查询" : "缺少凭证"}</>;
  const labels: Record<string, string> = { ok: "正常", error: "查询失败", unauthorized: "权限不足", unconfigured: "缺少凭证", pending: "等待查询", unsupported: "暂不支持" };
  return <>{a.sample.stale && a.sample.status === "ok" ? "待刷新" : labels[a.sample.status] ?? a.sample.status}{a.sample.stale && <Tag color="warning">已过期</Tag>}</>;
}
