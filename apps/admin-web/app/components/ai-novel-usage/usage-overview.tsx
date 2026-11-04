import { Alert, Card, Empty, Progress, Select, Statistic } from "antd";
import { useMemo, useState } from "react";
import type {
  UsageQuery,
  UsageReport,
  UsageTier,
} from "../../lib/ai-novel-usage-api";
import {
  usageChartOptions,
  USAGE_COLORS,
} from "../../lib/ai-novel-usage-charts";
import { formatBillingMoney } from "../../lib/billing-format";
import { LlmChart } from "../llm-monitor/llm-chart";
import { UsageReplay } from "./usage-replay";
import { UsageUserSection } from "./usage-user-section";
import { UsageRefunds } from "./usage-refunds";

export function UsageOverview({
  report,
  query,
}: {
  report: UsageReport;
  query: UsageQuery;
}) {
  const [chosenCurrency, setCurrency] = useState("CNY");
  const currencies = [...new Set(report.money.map((r) => r.currency))];
  const currency = currencies.includes(chosenCurrency)
    ? chosenCurrency
    : (currencies[0] ?? "CNY");
  const charts = useMemo(
    () => usageChartOptions(report, currency),
    [report, currency],
  );
  return (
    <div className="stack">
      <Alert
        type="info"
        showIcon
        message="真实数据 · 只读分析"
        description={`消耗采集起点：${report.reportingSince ?? "尚未开始"}。迁移前消耗不回填。厂商金额成本不可统计，不以点数反推；支付环境筛选不作用于消耗，不计算利润或 ROI。`}
      />
      <UsageKpis report={report} />
      <div className="usage-tiers">
        {report.tiers.map((t) => (
          <UsageTierCard key={t.tier} tier={t} />
        ))}
      </div>
      <div>
        <span>财务图表币种 </span>
        <Select
          aria-label="财务图表币种"
          value={currency}
          onChange={setCurrency}
          options={(currencies.length ? currencies : ["CNY"]).map((c) => ({
            value: c,
            label: c,
          }))}
        />
      </div>
      <div className="usage-grid">
        {charts.map((c, i) => (
          <Card key={c.title} title={c.title}>
            {(i === 2 || i === 3) &&
            !report.tiers.some((t) => t.windows > 0) ? (
              <Empty description="暂无完整活跃窗口；不是已测得 0%" />
            ) : (
              <LlmChart option={c.option} summary={c.summary} height={280} />
            )}
            <p className="usage-muted">{c.summary}</p>
          </Card>
        ))}
      </div>
      <UsageReplay report={report} />
      <UsageUserSection report={report} query={query} />
      <UsageRefunds report={report} />
    </div>
  );
}

function UsageKpis({ report }: { report: UsageReport }) {
  const stats = report.summary;
  const payments = new Map<string, number>();
  report.money.forEach((r) =>
    payments.set(r.currency, (payments.get(r.currency) ?? 0) + r.grossMinor),
  );
  return (
    <>
      <div className="usage-kpis">
        {[
          ["确认支付用户", stats.payingUsers],
          ["活跃消耗用户", stats.activeUsers],
          ["账户实际扣点", stats.chargedPoints],
          ["活动点消耗", stats.giftPoints],
          ["平台承担超额", stats.absorbedPoints],
          ["额度拦截次数", stats.denied],
        ].map(([title, value]) => (
          <Card key={title}>
            <Statistic
              title={title}
              value={value}
              precision={
                typeof value === "number" && !Number.isInteger(value) ? 3 : 0
              }
            />
          </Card>
        ))}
      </div>
      <Card title="确认支付 · 不跨币种合计">
        {payments.size ? (
          <div className="usage-mini">
            {[...payments].map(([key, value]) => (
              <Statistic
                key={key}
                title={key}
                value={formatBillingMoney(value, key)}
              />
            ))}
          </div>
        ) : (
          <Empty description="筛选区间无有金额证据的确认支付" />
        )}
      </Card>
    </>
  );
}

function UsageTierCard({ tier: t }: { tier: UsageTier }) {
  const color = USAGE_COLORS[["free", "plus", "pro"].indexOf(t.tier)];
  return (
    <Card
      key={t.tier}
      title={t.tier.toUpperCase()}
      extra={`${t.limitPoints.toLocaleString()} 点 / 周`}
    >
      <Statistic
        title="平均周额度使用率"
        value={t.usedPercent ?? "—"}
        precision={1}
        suffix={t.usedPercent === null ? undefined : "%"}
      />
      <Progress
        percent={t.usedPercent ?? 0}
        showInfo={false}
        strokeColor={color}
      />
      <div className="usage-mini">
        <Statistic title="P50 消耗 / 点" value={t.p50 ?? "—"} precision={0} />
        <Statistic title="P95 消耗 / 点" value={t.p95 ?? "—"} precision={0} />
        <Statistic
          title="周额度用尽窗口"
          value={`${t.exhausted}/${t.windows}`}
        />
      </div>
      <p className="usage-muted">
        仅完整活跃窗口，排除 {t.excludedWindows} 个无活动 / 不完整 /
        档位变化窗口。
      </p>
    </Card>
  );
}
