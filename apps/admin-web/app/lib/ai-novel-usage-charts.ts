import type { EChartsCoreOption } from "echarts/core";
import type { UsageReport } from "./ai-novel-usage-api";

export const USAGE_COLORS = [
  "#9caec8",
  "#4779eb",
  "#9271dc",
  "#e6a05a",
  "#55b6a1",
];
const base = {
  color: USAGE_COLORS,
  tooltip: { trigger: "axis" },
  grid: { left: 65, right: 28, top: 45, bottom: 40 },
  legend: { top: 0 },
};
interface UsageChart {
  title: string;
  summary: string;
  option: EChartsCoreOption;
}

function seriesChart(
  labels: string[],
  series: Record<string, unknown>[],
  horizontal = false,
): EChartsCoreOption {
  return {
    ...base,
    xAxis: horizontal ? { type: "value" } : { type: "category", data: labels },
    yAxis: horizontal ? { type: "category", data: labels } : { type: "value" },
    series,
  };
}
function calendar(report: UsageReport) {
  const dates: string[] = [];
  for (
    let time = Date.parse(report.filter.from);
    time < Date.parse(report.filter.to);
    time += 86400_000
  )
    dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}
function currencyDigits(currency: string) {
  return (
    new Intl.NumberFormat("en", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits ?? 2
  );
}

export function usageChartOptions(
  report: UsageReport,
  currency: string,
): UsageChart[] {
  const dates = calendar(report);
  return [
    financeChart(report, currency, dates),
    debitChart(report, dates),
    distributionChart(report),
    exhaustionChart(report),
    modelChart(report),
    scatterChart(report, currency),
  ];
}

function financeChart(
  report: UsageReport,
  currency: string,
  dates: string[],
): UsageChart {
  const rows = new Map(
    report.money
      .filter((row) => row.currency === currency)
      .map((row) => [row.date, row]),
  );
  const digits = currencyDigits(currency);
  const series = [{
    name: "支付",
    type: "line",
    connectNulls: false,
    data: dates.map((date) =>
      rows.has(date) ? rows.get(date)!.grossMinor / 10 ** digits : null,
    ),
  }];
  return {
    title: `支付趋势 · ${currency}`,
    summary:
      "真实支付证据按各自发生日期汇总；没有记录的日期保留空缺，不补财务零",
    option: seriesChart(dates, series),
  };
}
function debitChart(report: UsageReport, dates: string[]): UsageChart {
  const rows = new Map(report.daily.map((row) => [row.date, row]));
  const series = (
    ["periodicPoints", "giftPoints", "absorbedPoints"] as const
  ).map((key, i) => ({
    name: ["周额度", "活动点", "平台承担"][i],
    type: "bar",
    stack: "points",
    data: dates.map((date) => rows.get(date)?.[key] ?? null),
  }));
  return {
    title: "两池扣点与平台承担",
    summary:
      "周额度、活动点与余额不足时由平台承担的点数；没有证据的日期保留空缺",
    option: seriesChart(dates, series),
  };
}
function distributionChart(report: UsageReport): UsageChart {
  const series = ["低于25%", "25–50%", "50–80%", "80–100%", "已用尽"].map(
    (name, i) => ({
      name,
      type: "bar",
      stack: "windows",
      data: report.tiers.map((t) =>
        t.windows ? (t.distribution[i]! / t.windows) * 100 : null,
      ),
    }),
  );
  return {
    title: "周额度使用率分布",
    summary:
      "完整活跃窗口；无样本档位保留空缺，排除历史不完整、档位变化和进行中窗口",
    option: seriesChart(
      report.tiers.map((t) => t.tier),
      series,
      true,
    ),
  };
}
function exhaustionChart(report: UsageReport): UsageChart {
  const option = seriesChart(
    Array.from({ length: 7 }, (_, i) => `第${i + 1}天`),
    report.tiers.map((t) => ({
      name: t.tier,
      type: "bar",
      data: t.windows ? t.exhaustionDays : Array(7).fill(null),
    })),
  );
  return {
    title: "周额度用尽时间",
    summary: "每个完整活跃窗口第一次用尽周额度发生在第几天",
    option: { ...option, yAxis: { type: "value", minInterval: 1 } },
  };
}
function modelChart(report: UsageReport): UsageChart {
  return {
    title: "模型应扣点数",
    summary: "应扣点数包含实际扣点与平台承担，不是厂商货币成本",
    option: {
      ...seriesChart(
        report.models.map((r) => r.modelKey),
        [
          {
            name: "应扣点数",
            type: "bar",
            data: report.models.map((r) => r.points),
          },
        ],
        true,
      ),
      grid: { left: 155, right: 28, top: 35, bottom: 40 },
      yAxis: {
        type: "category",
        inverse: true,
        data: report.models.map((r) => r.modelKey),
      },
    },
  };
}
function escapeHtml(text: string) {
  return text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}
function scatterChart(report: UsageReport, currency: string): UsageChart {
  const digits = currencyDigits(currency);
  return {
    title: `用户支付与扣点 · ${currency}`,
    summary: "区间扣点最高的最多200位用户；支付与点数单位不同，不能视为利润",
    option: {
      ...base,
      tooltip: {
        trigger: "item",
        formatter: (p: unknown) => {
          const data = (p as { data: { name: string; value: number[] } }).data;
          return `${escapeHtml(data.name)}<br/>支付 ${escapeHtml(currency)} ${data.value[0]}<br/>扣点 ${data.value[1]}`;
        },
      },
      xAxis: { type: "value", name: currency },
      yAxis: { type: "value", name: "点" },
      series: [
        {
          type: "scatter",
          symbolSize: 8,
          data: report.users.map((u) => ({
            name: u.userId,
            value: [
              (u.payments.find((p) => p.currency === currency)?.grossMinor ??
                0) /
                10 ** digits,
              u.chargedPoints,
            ],
          })),
        },
      ],
    },
  };
}

export function replayResult(
  consumption: number[],
  quota: number,
  current: number,
) {
  const hits = consumption.filter((v) => v >= quota).length;
  return {
    hits,
    total: consumption.length,
    percent: consumption.length ? (1 - hits / consumption.length) * 100 : null,
    change: hits - consumption.filter((v) => v >= current).length,
  };
}
