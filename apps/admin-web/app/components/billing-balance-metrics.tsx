const labels: Record<string, string> = { geyan_app_remaining: "APP 一键认证", geyan_h5_remaining: "H5 一键认证" };

function formatRemaining(remaining: number | null, unit: string): string {
  if (remaining === null) return "未知";
  if (unit === "USD" || unit === "CNY") return remaining.toFixed(2);
  return String(remaining);
}

export function BillingBalanceMetrics({ metrics }: { metrics?: { kind?: string; remaining: number | null; unit: string }[] }) {
  if (!metrics?.length) return <>—</>;
  return <>{metrics.map((metric, index) => <div key={index}>{metric.kind && labels[metric.kind] ? `${labels[metric.kind]}：` : ""}{formatRemaining(metric.remaining, metric.unit)} {metric.unit}</div>)}</>;
}
