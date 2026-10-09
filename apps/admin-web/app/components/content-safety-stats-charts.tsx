import { Collapse, Empty, Table } from "antd";
import { LlmChart } from "./llm-monitor/llm-chart";
import { buildSafetyCategories, buildSafetyPie, buildSafetyTrend, formatSafetyPercent, safetyStatsPresentation } from "./content-safety-stats-view-model";
import type { AdminContentSafetyStatsDocument } from "../lib/types";

export function ContentSafetyStatsCharts({ stats }: { stats: AdminContentSafetyStatsDocument }) {
  const view = safetyStatsPresentation(stats);
  return <>
    <div className="content-safety-stats-grid">
      <section className="content-safety-stats-card">
        <h4>审核结果分布</h4>
        <p>已完成 {view.completed} 次；占比按已完成审核计算，不包含尚未完成的请求。</p>
        {view.pending > 0 && <p role="status">尚未完成：{view.pending} 次</p>}
        {view.completed > 0 ? <LlmChart option={buildSafetyPie(stats)} summary={`审核结果：通过 ${stats.summary.passed} 次，拦截 ${stats.summary.blocked} 次，失败默认放行 ${stats.summary.failedOpen} 次`} />
          : <Empty description="暂无已完成审核" />}
      </section>
      <section className="content-safety-stats-card">
        <h4>每日审核趋势</h4>
        <p>通过、拦截、失败默认放行；按审核发起日期归桶。</p>
        {view.completed > 0 ? <LlmChart option={buildSafetyTrend(stats)} summary="每日通过、拦截、失败默认放行次数的堆叠柱状图" />
          : <Empty description="暂无已完成审核" />}
      </section>
    </div>
    <section className="content-safety-stats-card">
      <h4>拦截原因</h4>
      {view.categories.length ? <LlmChart height={Math.max(240, view.categories.length * 36 + 50)} option={buildSafetyCategories(stats)} summary={view.categories.map(item => `${item.label} ${item.blocked} 次`).join("，")} />
        : <Empty description="当前范围没有拦截记录" />}
    </section>
    <section className="content-safety-stats-card">
      <h4>模型 / 审核方式表现</h4>
      <p>比例以该模型 / 方式的发起次数为分母；成功判定包含通过和拦截。</p>
      <Table columns={[
        { title: "模型 / 方式", dataIndex: "label" },
        { title: "发起次数", dataIndex: "count" },
        { title: "成功判定", dataIndex: "successful" },
        { title: "通过", dataIndex: "passed" },
        { title: "拦截", dataIndex: "blocked" },
        { title: "拦截率", dataIndex: "blockRate", render: formatSafetyPercent },
        { title: "失败默认放行次数", dataIndex: "failedOpen" },
        { title: "失败默认放行率", dataIndex: "failedOpenRate", render: formatSafetyPercent },
      ]} dataSource={view.models} pagination={false} rowKey="key" size="small" scroll={{ x: 950 }} />
    </section>
    <Collapse items={[{ key: "daily", label: "每日明细", children:
      <Table columns={[
        { title: "日期", dataIndex: "date" },
        { title: "发起", dataIndex: "total" },
        { title: "成功判定", dataIndex: "successful" },
        { title: "通过", dataIndex: "passed" },
        { title: "拦截", dataIndex: "blocked" },
        { title: "失败默认放行次数", dataIndex: "failedOpen" },
      ]} dataSource={stats.daily} pagination={false} rowKey="date" size="small" scroll={{ x: 680 }} />,
    }]} />
  </>;
}
