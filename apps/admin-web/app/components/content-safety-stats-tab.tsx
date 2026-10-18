import { Button, Select } from "antd";
import { useEffect, useRef, useState } from "react";

import { MetricCard } from "./metric-card";
import { ContentSafetyStatsCharts } from "./content-safety-stats-charts";
import { formatSafetyPercent } from "./content-safety-stats-view-model";
import { adminApi } from "../lib/admin-api";
import { formatApiError, makeNotice } from "../lib/format";
import { useAdminSession } from "../lib/admin-session";
import type { AdminContentSafetyStatsDocument } from "../lib/types";

function getDateRange(range: string) {
  const days = range === "7d" ? 7 : 30;
  // Counter buckets use Asia/Shanghai, independent of the administrator's timezone.
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}

export function ContentSafetyStatsTab() {
  const { clearNotice, setNotice } = useAdminSession();
  const [range, setRange] = useState("30d");
  const querying = useRef(false);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState<AdminContentSafetyStatsDocument | null>(null);

  // The parent mounts this component only when the statistics tab is selected.
  useEffect(() => {
    void loadStats();
  }, []);

  async function loadStats() {
    if (querying.current) return;
    querying.current = true;
    setLoading(true);
    clearNotice();
    try {
      setStats(await adminApi.getContentSafetyStats({
        ...getDateRange(range),
      }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      querying.current = false;
      setLoading(false);
    }
  }

  return (
    <section className="content-safety-section">
      <div className="section-heading">
        <div>
          <h3>数据统计</h3>
          <p>Redis 按天计数：审核发起、成功判定、拦截类别、失败默认放行及使用模型。新统计从部署后开始，不回查历史明细。</p>
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
          <Button loading={loading} onClick={() => void loadStats()} type="primary">
            查询
          </Button>
        </div>
      </div>
      {stats ? (
        <div className="stack">
          <div className="metric-grid">
            <MetricCard label="审核总量" value={stats.summary.total.toString()} />
            <MetricCard label="拦截次数" value={stats.summary.blocked.toString()} />
            <MetricCard label="拦截率" value={formatSafetyPercent(stats.summary.blockRate)} />
            <MetricCard label="失败默认放行率" value={formatSafetyPercent(stats.summary.failedOpenRate)} />
            <MetricCard label="成功判定" value={stats.summary.successful.toString()} />
            <MetricCard label="失败默认放行次数" value={stats.summary.failedOpen.toString()} />
          </div>
          <ContentSafetyStatsCharts stats={stats} />
        </div>
      ) : (
        <div className="empty-inline">{loading ? "正在查询内容安全统计…" : "暂无统计数据，请重试查询。"}</div>
      )}
    </section>
  );
}
