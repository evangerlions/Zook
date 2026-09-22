import { Alert, Card, Col, Progress, Row, Select, Space, Statistic, Table, Tag } from "antd";
import { useEffect, useState } from "react";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";
import type { BodyLogCheckinDashboardDocument, BodyLogRange } from "../lib/types";

export default function BodyLogRoute() {
  const { selectedAppId, setNotice, completeWorkspaceTransition } = useAdminSession();
  const [range, setRange] = useState<BodyLogRange>("30d");
  const [document, setDocument] = useState<BodyLogCheckinDashboardDocument | null>(null);

  useEffect(() => {
    if (selectedAppId !== "bodylog") {
      setDocument(null);
      completeWorkspaceTransition();
      return;
    }
    adminApi.getBodyLogCheckinDashboard(range)
      .then(setDocument)
      .catch(error => setNotice(makeNotice("error", formatApiError(error))))
      .finally(completeWorkspaceTransition);
  }, [selectedAppId, range]);

  if (selectedAppId !== "bodylog") return <section className="empty-state">请先切换到 BodyLog 项目空间。</section>;
  if (!document) return <section className="empty-state">正在加载 BodyLog 打卡概览…</section>;

  const { summary } = document;
  return <section className="stack">
    <header className="page-header">
      <div><h1>BodyLog 打卡概览</h1><p>聚合展示打卡活跃度、完成率与习惯分布，不展示用户私密内容。</p></div>
      <Select value={range} onChange={setRange} options={[{ value: "7d", label: "近 7 天" }, { value: "30d", label: "近 30 天" }, { value: "90d", label: "近 90 天" }]} />
    </header>
    <Alert type="info" showIcon message="隐私边界" description="当前页面只展示聚合指标；用户级记录需要通过打卡记录页面并完成二次授权。" />
    <Row gutter={[16, 16]}>
      <Col xs={12} lg={6}><Card><Statistic title="DAU" value={summary.dau} /></Card></Col>
      <Col xs={12} lg={6}><Card><Statistic title="今日打卡" value={summary.checkins_today} /></Card></Col>
      <Col xs={12} lg={6}><Card><Statistic title="活跃群组" value={summary.active_groups} suffix={`/ ${summary.total_groups}`} /></Card></Col>
      <Col xs={12} lg={6}><Card><Statistic title="群组成员" value={summary.total_members} /></Card></Col>
    </Row>
    <Card title="打卡率">
      <Space size="large" wrap>
        <Progress type="circle" percent={Math.round(summary.checkin_rate_daily)} size={100} format={value => `日 ${value}%`} />
        <Progress type="circle" percent={Math.round(summary.checkin_rate_weekly)} size={100} format={value => `周 ${value}%`} />
        <Progress type="circle" percent={Math.round(summary.checkin_rate_monthly)} size={100} format={value => `月 ${value}%`} />
      </Space>
    </Card>
    <Card title="每日趋势"><Table rowKey="date" pagination={false} dataSource={document.trend} columns={[
      { title: "日期", dataIndex: "date" }, { title: "DAU", dataIndex: "dau" }, { title: "打卡数", dataIndex: "checkins" },
      { title: "完成率", dataIndex: "completion_rate", render: (value: number) => `${Math.round(value)}%` },
    ]} /></Card>
    <Row gutter={[16, 16]}>
      <Col xs={24} lg={12}><Card title="连续打卡分布"><Table rowKey="bucket" pagination={false} dataSource={document.consecutive_distribution} columns={[{ title: "连续天数", dataIndex: "bucket" }, { title: "群组/用户数", dataIndex: "users" }]} /></Card></Col>
      <Col xs={24} lg={12}><Card title="习惯分布"><Table rowKey="habit_id" pagination={false} dataSource={document.habit_distribution} columns={[{ title: "习惯", dataIndex: "habit_id" }, { title: "打卡数", dataIndex: "checkins" }, { title: "占比", dataIndex: "share", render: (value: number) => <Tag color="blue">{Math.round(value * 100)}%</Tag> }]} /></Card></Col>
    </Row>
  </section>;
}
