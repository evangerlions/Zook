import type { BillingBalanceMetric } from "../lib/billing-accounts";
import { formatTimestamp } from "../lib/format";

const labels: Record<string, string> = {
  geyan_app_remaining: "APP 一键认证",
  geyan_h5_remaining: "H5 一键认证",
  token_plan_monthly_remaining: "本月套餐剩余",
  agent_plan_5h_remaining: "5 小时剩余",
  agent_plan_weekly_remaining: "一周剩余",
  agent_plan_monthly_remaining: "一月剩余",
};

function formatRemaining(remaining: number | null, unit: string): string {
  if (remaining === null) return "未知";
  if (unit === "USD" || unit === "CNY") return remaining.toFixed(2);
  if (unit === "%") return Number(remaining.toFixed(2)).toString();
  return String(remaining);
}

export function BillingBalanceMetrics({ metrics }: { metrics?: BillingBalanceMetric[] }) {
  if (!metrics?.length) return <>—</>;
  return <>{metrics.map((metric, index) => <div key={index}>
    {metric.kind && labels[metric.kind] ? `${labels[metric.kind]}：` : ""}
    {formatRemaining(metric.remaining, metric.unit)}{metric.unit === "%" ? "%" : ` ${metric.unit}`}
    {metric.resetAt && <div>重置时间 {formatTimestamp(metric.resetAt)}</div>}
  </div>)}</>;
}
