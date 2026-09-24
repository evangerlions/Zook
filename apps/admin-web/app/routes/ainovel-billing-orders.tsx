import { ReloadOutlined } from "@ant-design/icons";
import {
  Alert,
  Button,
  DatePicker,
  Descriptions,
  Drawer,
  Empty,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Timeline,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import { useEffect, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import {
  billingProductLabel,
  billingStatusColor,
  billingStatusLabel,
  BILLING_STATUS_OPTIONS,
  formatBillingMoney,
} from "../lib/ainovel-billing";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminBillingEvent,
  AdminBillingOrder,
  AdminBillingOrderDetail,
  AdminBillingOrderPage,
  AiNovelBillingOrderStatus,
} from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";

interface BillingFilters {
  userId?: string;
  providerTransactionId?: string;
  platform?: string;
  distribution?: string;
  status?: AiNovelBillingOrderStatus;
  createdFrom?: string;
  createdTo?: string;
}

export default function AiNovelBillingOrdersRoute() {
  const { apps, selectedAppId, completeWorkspaceTransition, setNotice } = useAdminSession();
  const aiNovelApp = apps.find((app) => app.appId === AI_NOVEL_APP_ID);
  const selectedApp = apps.find((app) => app.appId === selectedAppId);
  const [filters, setFilters] = useState<BillingFilters>({});
  const [userId, setUserId] = useState("");
  const [transactionId, setTransactionId] = useState("");
  const [platform, setPlatform] = useState<string>();
  const [distribution, setDistribution] = useState<string>();
  const [status, setStatus] = useState<AiNovelBillingOrderStatus>();
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState<AdminBillingOrderPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AdminBillingOrder | null>(null);
  const [detail, setDetail] = useState<AdminBillingOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function loadOrders(nextFilters: BillingFilters, append = false, cursor?: string) {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setPage(null);
      completeWorkspaceTransition();
      return;
    }
    setLoading(true);
    try {
      const result = await adminApi.getAiNovelBillingOrders({ ...nextFilters, limit: 50, cursor });
      setPage((current) => append && current
        ? { items: [...current.items, ...result.items], nextCursor: result.nextCursor }
        : result);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setPage(null);
      completeWorkspaceTransition();
      return;
    }
    void loadOrders(filters);
  }, [selectedAppId]);

  function applyFilters() {
    const nextFilters: BillingFilters = {
      userId: userId.trim() || undefined,
      providerTransactionId: transactionId.trim() || undefined,
      platform,
      distribution,
      status,
      createdFrom: dateRange?.[0]?.startOf("day").toISOString(),
      createdTo: dateRange?.[1]?.endOf("day").toISOString(),
    };
    setFilters(nextFilters);
    void loadOrders(nextFilters);
  }

  function clearFilters() {
    setUserId("");
    setTransactionId("");
    setPlatform(undefined);
    setDistribution(undefined);
    setStatus(undefined);
    setDateRange(null);
    setFilters({});
    void loadOrders({});
  }

  async function openOrder(order: AdminBillingOrder) {
    setSelectedOrder(order);
    setDetail(null);
    setDetailLoading(true);
    try {
      setDetail(await adminApi.getAiNovelBillingOrder(order.paymentId, { eventsLimit: 50 }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setDetailLoading(false);
    }
  }

  async function loadOlderEvents() {
    if (!detail || !selectedOrder?.paymentId || !detail.eventsNextCursor) return;
    setEventsLoading(true);
    try {
      const next = await adminApi.getAiNovelBillingOrder(selectedOrder.paymentId, {
        eventsCursor: detail.eventsNextCursor,
        eventsLimit: 50,
      });
      setDetail((current) => current ? {
        ...current,
        events: [...current.events, ...next.events],
        eventsNextCursor: next.eventsNextCursor,
      } : current);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setEventsLoading(false);
    }
  }

  if (!aiNovelApp) {
    return <section className="empty-state">当前工作区中还没有 `ai_novel` 项目，暂时无法查看支付订单。</section>;
  }
  if (selectedApp?.appId !== AI_NOVEL_APP_ID) {
    return <section className="empty-state">支付订单仅适用于 `ai_novel`。请先切换到该项目空间。</section>;
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>支付订单</h1>
          <p>查看 Zook 已持久化的 RevenueCat 交易快照与已验证 webhook 事件；Docker stdout 日志仍用于全流程 deep-dive。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadOrders(filters)}>刷新</Button>
      </header>

      <Alert
        showIcon
        type="info"
        message="当前只展示 App Store / Google Play 经 RevenueCat 记录的交易。缺少供应商金额时显示“—”；当前系统未持久化独立 checkout、支付宝或 grant ledger。"
      />

      <section className="surface-card">
        <Space wrap>
          <Input
            aria-label="用户 ID"
            onChange={(event) => setUserId(event.target.value)}
            onPressEnter={applyFilters}
            placeholder="用户 ID"
            value={userId}
            style={{ width: 190 }}
          />
          <Input
            aria-label="RevenueCat 交易 ID"
            onChange={(event) => setTransactionId(event.target.value)}
            onPressEnter={applyFilters}
            placeholder="RevenueCat 交易 ID"
            value={transactionId}
            style={{ width: 220 }}
          />
          <Select
            allowClear
            aria-label="平台"
            onChange={setPlatform}
            options={[
              { value: "ios", label: "iOS" },
              { value: "android", label: "Android" },
              { value: "macos", label: "macOS" },
            ]}
            placeholder="平台"
            style={{ width: 130 }}
            value={platform}
          />
          <Select
            allowClear
            aria-label="商店"
            onChange={setDistribution}
            options={[
              { value: "app_store", label: "App Store" },
              { value: "google_play", label: "Google Play" },
            ]}
            placeholder="商店"
            style={{ width: 150 }}
            value={distribution}
          />
          <Select
            allowClear
            aria-label="订单状态"
            onChange={(value) => setStatus(value as AiNovelBillingOrderStatus | undefined)}
            options={BILLING_STATUS_OPTIONS}
            placeholder="订单状态"
            style={{ width: 145 }}
            value={status}
          />
          <DatePicker.RangePicker onChange={setDateRange} value={dateRange} />
          <Button type="primary" onClick={applyFilters}>查询</Button>
          <Button onClick={clearFilters}>清空</Button>
        </Space>
      </section>

      <section className="surface-card">
        <Table<AdminBillingOrder>
          columns={[
            { title: "下单时间", dataIndex: "createdAt", width: 175, render: formatTimestamp },
            { title: "用户 ID", dataIndex: "userId", width: 170, ellipsis: true },
            {
              title: "商品",
              width: 150,
              render: (_, order) => <Space direction="vertical" size={0}><strong>{billingProductLabel(order)}</strong><Typography.Text type="secondary">{order.productKey}</Typography.Text></Space>,
            },
            { title: "平台", dataIndex: "platform", width: 100, render: (value) => value ?? "—" },
            { title: "交易金额", width: 135, render: (_, order) => formatBillingMoney(order.amountMinor, order.currency) },
            {
              title: "状态",
              width: 210,
              render: (_, order) => (
                <Space wrap>
                  <Tag color={billingStatusColor(order.paymentStatus)}>{billingStatusLabel(order.paymentStatus)}</Tag>
                  <Tag color={billingStatusColor(order.entitlementStatus)}>{billingStatusLabel(order.entitlementStatus)}</Tag>
                </Space>
              ),
            },
            { title: "环境", dataIndex: "environment", width: 115, render: (value) => value === "SANDBOX" ? <Tag color="blue">Sandbox</Tag> : value === "PRODUCTION" ? "Production" : "—" },
            { title: "交易 ID", dataIndex: "providerTransactionId", ellipsis: true },
            { title: "操作", width: 90, render: (_, order) => <Button size="small" onClick={() => void openOrder(order)}>详情</Button> },
          ]}
          dataSource={page?.items ?? []}
          loading={loading}
          pagination={false}
          rowKey="paymentId"
          locale={{ emptyText: <Empty description="暂无支付记录" /> }}
          scroll={{ x: 1250 }}
        />
        {page?.nextCursor ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}>
            <Button loading={loading} onClick={() => void loadOrders(filters, true, page.nextCursor ?? undefined)}>加载更多</Button>
          </div>
        ) : null}
      </section>

      <Drawer
        destroyOnClose
        onClose={() => setSelectedOrder(null)}
        open={selectedOrder !== null}
        size="large"
        title="支付订单详情"
      >
        {detailLoading ? <div style={{ padding: 32, textAlign: "center" }}>加载中…</div> : detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small" title="订单">
              <Descriptions.Item label="支付记录 ID">{detail.order.paymentId}</Descriptions.Item>
              <Descriptions.Item label="用户 ID">{detail.order.userId}</Descriptions.Item>
              <Descriptions.Item label="支付平台">RevenueCat · {detail.order.platform ?? "未知平台"}</Descriptions.Item>
              <Descriptions.Item label="商店">{detail.order.distribution}</Descriptions.Item>
              <Descriptions.Item label="商品">{detail.order.productKey}</Descriptions.Item>
              <Descriptions.Item label="金额">{formatBillingMoney(detail.order.amountMinor, detail.order.currency)}</Descriptions.Item>
              <Descriptions.Item label="支付状态"><Tag color={billingStatusColor(detail.order.paymentStatus)}>{billingStatusLabel(detail.order.paymentStatus)}</Tag></Descriptions.Item>
              <Descriptions.Item label="权益状态"><Tag color={billingStatusColor(detail.order.entitlementStatus)}>{billingStatusLabel(detail.order.entitlementStatus)}</Tag></Descriptions.Item>
              <Descriptions.Item label="环境">{detail.order.environment ?? "未知"}</Descriptions.Item>
              <Descriptions.Item label="购买时间">{formatTimestamp(detail.order.paidAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="到期时间">{formatTimestamp(detail.order.expiresAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="账号删除标记">{formatTimestamp(detail.order.deletedAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="RevenueCat 交易 ID" span={2}>{detail.order.providerTransactionId}</Descriptions.Item>
            </Descriptions>

            <Descriptions bordered column={2} size="small" title="当前会员状态">
              <Descriptions.Item label="有效">{detail.currentMembership ? detail.currentMembership.active ? "是" : "否" : "暂无同步记录"}</Descriptions.Item>
              <Descriptions.Item label="状态">{detail.currentMembership?.state ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="档位 / 商品">{detail.currentMembership?.planKey ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="到期">{formatTimestamp(detail.currentMembership?.expiresAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="自动续订">{detail.currentMembership?.autoRenew == null ? "未知" : detail.currentMembership.autoRenew ? "是" : "否"}</Descriptions.Item>
              <Descriptions.Item label="最后同步">{formatTimestamp(detail.currentMembership?.lastSyncedAt ?? undefined)}</Descriptions.Item>
            </Descriptions>

            <section>
              <h3>交易记录</h3>
              {detail.transactions.map((item) => (
                <Descriptions bordered column={2} key={item.transactionId} size="small">
                  <Descriptions.Item label="类型">{transactionKindLabel(item.transactionKind)}</Descriptions.Item>
                  <Descriptions.Item label="状态">{billingStatusLabel(item.status)}</Descriptions.Item>
                  <Descriptions.Item label="交易金额">{formatBillingMoney(item.amountMinor, item.currency)}</Descriptions.Item>
                  <Descriptions.Item label="退款金额">{formatBillingMoney(item.refundAmountMinor, item.currency)}</Descriptions.Item>
                  <Descriptions.Item label="交易 ID" span={2}>{item.providerTransactionId}</Descriptions.Item>
                </Descriptions>
              ))}
            </section>

            <section>
              <h3>RevenueCat Webhook 时间线</h3>
              {detail.events.length ? <Timeline items={detail.events.map(eventTimelineItem)} /> : <Empty description="没有与此交易关联的 webhook 事件" />}
              {detail.eventsNextCursor ? <Button loading={eventsLoading} onClick={() => void loadOlderEvents()}>加载更早事件</Button> : null}
            </section>
            <Alert showIcon type="info" message="权益当前以 Zook 会员状态快照为准；目前没有单独的 entitlement grant 台账。Webhook 时间线只显示已持久化的事件元数据，不包含原始 payload。" />
          </Space>
        ) : <Empty description="无法加载订单详情" />}
      </Drawer>
    </section>
  );
}

function transactionKindLabel(value: string): string {
  return value === "renewal" ? "续订" : value === "refund" ? "退款" : value === "revoke" ? "撤销" : "购买";
}

function eventTimelineItem(event: AdminBillingEvent) {
  return {
    color: event.processingStatus === "processed" ? "green" : "gray",
    children: (
      <Space direction="vertical" size={2}>
        <Space><Tag>{event.eventType}</Tag><Tag color={event.processingStatus === "processed" ? "green" : "default"}>{event.processingStatus === "processed" ? "已处理" : "已忽略"}</Tag></Space>
        <Typography.Text type="secondary">发生：{event.occurredAt ? formatTimestamp(event.occurredAt) : "未知"} · 接收：{formatTimestamp(event.processedAt)}</Typography.Text>
        {event.eventType === "TRANSFER" && event.affectedUserIds.length > 0 ? <Typography.Text type="secondary">转移涉及账号：{event.affectedUserIds.join("、")}</Typography.Text> : null}
        {event.accountDeletedAt ? <Typography.Text type="secondary">账号删除标记：{formatTimestamp(event.accountDeletedAt)}</Typography.Text> : null}
        <Typography.Text copyable={{ text: event.providerEventId }}>事件 ID：{event.providerEventId}</Typography.Text>
      </Space>
    ),
  };
}
