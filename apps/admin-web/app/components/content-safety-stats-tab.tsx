import { Button, Select, Table } from "antd";
import { useState } from "react";

import { MetricCard } from "./metric-card";
import { adminApi } from "../lib/admin-api";
import { formatApiError, makeNotice } from "../lib/format";
import { useAdminSession } from "../lib/admin-session";
import type { AdminContentSafetyStatsBucket, AdminContentSafetyStatsDocument } from "../lib/types";

function getDateRange(range: string) {
  const days = range === "7d" ? 7 : 30;
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function StatsBucketTable({
  items,
  title,
}: {
  items: AdminContentSafetyStatsBucket[];
  title: string;
}) {
  return (
    <div className="content-safety-stats-card">
      <h4>{title}</h4>
      <Table
        columns={[
          { title: "Key", dataIndex: "key" },
          { title: "总量", dataIndex: "count", width: 70 },
          { title: "拦截", dataIndex: "blocked", width: 70 },
          { title: "Fail-open", dataIndex: "failedOpen", width: 90 },
          { title: "均耗时", dataIndex: "avgLatencyMs", width: 80 },
        ]}
        dataSource={items}
        pagination={false}
        rowKey="key"
        size="small"
      />
    </div>
  );
}

export function ContentSafetyStatsTab() {
  const { clearNotice, setNotice } = useAdminSession();
  const [range, setRange] = useState("30d");
  const [source, setSource] = useState("");
  const [method, setMethod] = useState("");
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AdminContentSafetyStatsDocument | null>(null);

  async function loadStats() {
    setLoading(true);
    clearNotice();
    try {
      setStats(await adminApi.getContentSafetyStats({
        ...getDateRange(range),
        source: source || undefined,
        method: method || undefined,
      }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="content-safety-section">
      <div className="section-heading">
        <div>
          <h3>数据统计</h3>
          <p>统计审核总量、拦截率、fail-open 率和各审核层级的表现。</p>
        </div>
        <div className="section-actions">
          <Select
            onChange={setRange}
            options={[
              { label: "最近 7 天", value: "7d" },
              { label: "最近 30 天", value: "30d" },
            ]}
            value={range}
          />
          <Select
            onChange={setSource}
            options={[
              { label: "全部来源", value: "" },
              { label: "业务请求", value: "business" },
              { label: "Admin 测试", value: "admin_test" },
            ]}
            value={source}
          />
          <Select
            onChange={setMethod}
            options={[
              { label: "全部方式", value: "" },
              { label: "未启用", value: "disabled" },
              { label: "关键词", value: "keyword" },
              { label: "LLM", value: "llm" },
              { label: "阿里云", value: "aliyun" },
              { label: "Fail-open", value: "failed_open" },
            ]}
            value={method}
          />
          <Button loading={loading} onClick={() => void loadStats()} type="primary">
            查询
          </Button>
        </div>
      </div>
      {stats ? (
        <div className="stack">
          <div className="metrics-grid">
            <MetricCard label="审核总量" value={stats.summary.total.toString()} />
            <MetricCard label="拦截次数" value={stats.summary.blocked.toString()} />
            <MetricCard label="拦截率" value={formatPercent(stats.summary.blockRate)} />
            <MetricCard label="Fail-open" value={formatPercent(stats.summary.failedOpenRate)} />
            <MetricCard label="平均耗时" value={`${stats.summary.avgLatencyMs} ms`} />
            <MetricCard label="P95 耗时" value={`${stats.summary.p95LatencyMs} ms`} />
          </div>
          <Table
            columns={[
              { title: "日期", dataIndex: "date" },
              { title: "总量", dataIndex: "total" },
              { title: "通过", dataIndex: "passed" },
              { title: "拦截", dataIndex: "blocked" },
              { title: "Fail-open", dataIndex: "failedOpen" },
            ]}
            dataSource={stats.daily}
            pagination={false}
            rowKey="date"
            size="small"
          />
          <div className="content-safety-stats-grid">
            <StatsBucketTable items={stats.byMethod} title="按审核方式" />
            <StatsBucketTable items={stats.bySource} title="按来源" />
            <StatsBucketTable items={stats.byApp} title="按 App" />
            <StatsBucketTable items={stats.byTaskType} title="按 Task Type" />
            <StatsBucketTable items={stats.byCategory} title="按分类" />
            <StatsBucketTable items={stats.byFailureReason} title="按 Fail-open 原因" />
            <StatsBucketTable items={stats.byLengthBucket} title="按文本长度" />
          </div>
        </div>
      ) : (
        <div className="empty-inline">点击查询后查看内容安全统计。</div>
      )}
    </section>
  );
}
