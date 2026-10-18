import type { EChartsCoreOption } from "echarts/core";
import type { AdminContentSafetyStatsDocument } from "../lib/types";

const outcomes = [
  { key: "passed", name: "通过", color: "#16a085" },
  { key: "blocked", name: "拦截", color: "#e05252" },
  { key: "failedOpen", name: "失败默认放行", color: "#d99520" },
] as const;

const categoryLabels: Record<string, string> = {
  geopolitics: "地缘政治", national_leaders: "国家领导人", political_security: "政治安全",
  terrorism_extremism: "恐怖主义与极端主义", violence_crime: "暴力犯罪",
  pornography_obscenity: "淫秽色情", gambling_drugs_illegal_trade: "赌博毒品与非法交易",
  fraud_privacy_abuse: "诈骗与隐私侵害", minors_self_harm_harmful: "未成年人及自伤危害",
  cult_superstition_harmful: "邪教与有害迷信",
};
const modelLabels: Record<string, string> = {
  jev: "Jev", qwen: "Qwen", keyword: "关键词", aliyun: "阿里云内容安全", disabled: "未启用审核",
};

export function formatSafetyPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function safetyStatsPresentation(stats: AdminContentSafetyStatsDocument) {
  const completed = stats.summary.passed + stats.summary.blocked + stats.summary.failedOpen;
  return {
    completed,
    pending: Math.max(0, stats.summary.total - completed),
    outcomes: outcomes.map(item => ({ ...item, value: stats.summary[item.key] })),
    categories: stats.byCategory.filter(item => item.blocked > 0)
      .map(item => ({ ...item, label: categoryLabels[item.key] ?? item.key }))
      .sort((a, b) => b.blocked - a.blocked || a.key.localeCompare(b.key)),
    models: stats.byModel.map(item => ({ ...item, label: modelLabels[item.key] ?? item.key,
      blockRate: item.count ? item.blocked / item.count : 0,
      failedOpenRate: item.count ? item.failedOpen / item.count : 0,
    })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}

export function buildSafetyPie(stats: AdminContentSafetyStatsDocument): EChartsCoreOption {
  const view = safetyStatsPresentation(stats);
  return {
    tooltip: { trigger: "item", renderMode: "richText", formatter: "{b}: {c} 次（{d}%）" },
    legend: { bottom: 0, left: "center", orient: "vertical", formatter: (name: string) => {
      const item = view.outcomes.find(outcome => outcome.name === name);
      return item ? `${name}  ${item.value} 次（${formatSafetyPercent(view.completed ? item.value / view.completed : 0)}）` : name;
    } },
    series: [{ type: "pie", radius: ["35%", "60%"], center: ["50%", "40%"],
      stillShowZeroSum: false,
      label: { position: "inside", formatter: "{d}%" },
      data: view.outcomes.map(item => ({ name: item.name, value: item.value, itemStyle: { color: item.color } })),
    }],
  };
}

export function buildSafetyTrend(stats: AdminContentSafetyStatsDocument): EChartsCoreOption {
  const days = [...stats.daily].sort((a, b) => a.date.localeCompare(b.date));
  return {
    tooltip: { trigger: "axis", renderMode: "richText", axisPointer: { type: "shadow" } },
    legend: { bottom: 0 }, grid: { left: 12, right: 12, top: 20, bottom: 55, containLabel: true },
    xAxis: { type: "category", data: days.map(item => item.date.slice(5)) },
    yAxis: { type: "value", minInterval: 1 },
    series: outcomes.map(item => ({ name: item.name, type: "bar", stack: "completed",
      itemStyle: { color: item.color }, data: days.map(day => day[item.key]),
    })),
  };
}

export function buildSafetyCategories(stats: AdminContentSafetyStatsDocument): EChartsCoreOption {
  const items = safetyStatsPresentation(stats).categories;
  return {
    tooltip: { trigger: "axis", renderMode: "richText", axisPointer: { type: "shadow" } },
    grid: { left: 12, right: 40, top: 12, bottom: 20, containLabel: true },
    xAxis: { type: "value", minInterval: 1 },
    yAxis: { type: "category", inverse: true, data: items.map(item => item.label),
      axisLabel: { width: 130, overflow: "truncate" },
    },
    series: [{ name: "拦截次数", type: "bar", itemStyle: { color: "#e05252" },
      label: { show: true, position: "right" }, data: items.map(item => item.blocked),
    }],
  };
}
