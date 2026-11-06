import { BILLING_TERMS, billingTermValue } from "../lib/billing-terms";
import { BillingRenewalStatus } from "./billing-renewal-status";
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
  Tooltip,
  Typography,
} from "antd";
import type { Dayjs } from "dayjs";
import { useEffect, useRef, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import {
  billingProductLabel,
  billingStatusColor,
  billingStatusLabel,
  BILLING_STATUS_OPTIONS,
  formatBillingMoney,
} from "../lib/billing-format";
import { formatApiError, formatTimestamp, formatTimestampSeconds, makeNotice } from "../lib/format";
import type {
  AdminBillingEvent,
  AdminBillingOrder,
  AdminBillingOrderDetail,
  AdminBillingOrderPage,
  BillingOrderStatus,
} from "../lib/types";

interface BillingFilters {
  provider?: "revenuecat" | "alipay";
  userId?: string;
  providerTransactionId?: string;
  platform?: string;
  distribution?: string;
  status?: BillingOrderStatus;
  createdFrom?: string;
  createdTo?: string;
}

function renderOrderIdentifier(value: string | null | undefined) {
  if (!value) return "—";
  return (
    <Tooltip title={value} trigger={["hover", "focus"]} styles={{ root: { overflowWrap: "anywhere" } }}>
      <span tabIndex={0} style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </Tooltip>
  );
}

const DEFAULT_ORDER_STATUS: BillingOrderStatus = "provider_paid";

export function BillingOrdersSection({ appId, environment, initialUserId }: {
  appId: string;
  environment: "PRODUCTION" | "SANDBOX";
  initialUserId?: string;
}) {
  const { setNotice } = useAdminSession();
  const ordersRequest = useRef(0);
  const detailRequest = useRef(0);
  const [filters, setFilters] = useState<BillingFilters>({ status: DEFAULT_ORDER_STATUS, userId: initialUserId });
  const [userId, setUserId] = useState(initialUserId ?? "");
  const [transactionId, setTransactionId] = useState("");
  const [provider, setProvider] = useState<"revenuecat" | "alipay">();
  const [platform, setPlatform] = useState<string>();
  const [distribution, setDistribution] = useState<string>();
  const [status, setStatus] = useState<BillingOrderStatus | undefined>(DEFAULT_ORDER_STATUS);
  const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [page, setPage] = useState<AdminBillingOrderPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<AdminBillingOrder | null>(null);
  const [detail, setDetail] = useState<AdminBillingOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [eventsLoading, setEventsLoading] = useState(false);

  async function loadOrders(nextFilters: BillingFilters, append = false, cursor?: string) {
    const request = ++ordersRequest.current;
    // A replacement query must not retain rows or a cursor from the previous filters,
    // including when the replacement request fails.
    if (!append) setPage(null);
    setLoading(true);
    try {
      const result = await adminApi.getBillingOrders({ ...nextFilters, appId, environment, limit: 50, cursor });
      if (request !== ordersRequest.current) return;
      setPage((current) => append && current
        ? { items: [...current.items, ...result.items], nextCursor: result.nextCursor }
        : result);
    } catch (error) {
      if (request === ordersRequest.current) setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      if (request === ordersRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders(filters);
    return () => { ordersRequest.current++; detailRequest.current++; };
  }, [appId, environment]);

  function applyFilters() {
    const nextFilters: BillingFilters = {
      userId: userId.trim() || undefined,
      providerTransactionId: transactionId.trim() || undefined,
      provider,
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
    setProvider(undefined);
    setPlatform(undefined);
    setDistribution(undefined);
    setStatus(DEFAULT_ORDER_STATUS);
    setDateRange(null);
    const defaults = { status: DEFAULT_ORDER_STATUS };
    setFilters(defaults);
    void loadOrders(defaults);
  }

  async function openOrder(order: AdminBillingOrder) {
    const request = ++detailRequest.current;
    setSelectedOrder(order);
    setDetail(null);
    setDetailLoading(true);
    try {
      const result = await adminApi.getBillingOrder(order.paymentId, { appId: order.appId, eventsLimit: 50 });
      if (request === detailRequest.current) setDetail(result);
    } catch (error) {
      if (request === detailRequest.current) setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      if (request === detailRequest.current) setDetailLoading(false);
    }
  }

  async function loadOlderEvents() {
    if (!detail || !selectedOrder?.paymentId || !detail.eventsNextCursor) return;
    setEventsLoading(true);
    const request = detailRequest.current;
    try {
      const next = await adminApi.getBillingOrder(selectedOrder.paymentId, {
        appId: selectedOrder.appId,
        eventsCursor: detail.eventsNextCursor,
        eventsLimit: 50,
      });
      if (request !== detailRequest.current) return;
      setDetail((current) => current ? {
        ...current,
        events: [...current.events, ...next.events],
        eventsNextCursor: next.eventsNextCursor,
      } : current);
    } catch (error) {
      if (request === detailRequest.current) setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      if (request === detailRequest.current) setEventsLoading(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>支付订单</h1>
          <p>查看 Zook 已持久化的商店交易、支付宝订单与已验证支付事件；Docker stdout 日志用于全流程排查。</p>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadOrders(filters)}>刷新</Button>
      </header>

      <Alert
        showIcon
        type="info"
        message="商店支付展示 RevenueCat 交易，支付宝展示已创建的订单（包括未付款和关闭）。金额不明时显示“—”；订单金额不等于已收款金额，请结合支付状态查看。"
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
            aria-label="供应商交易 ID"
            onChange={(event) => setTransactionId(event.target.value)}
            onPressEnter={applyFilters}
            placeholder="供应商交易 ID"
            value={transactionId}
            style={{ width: 220 }}
          />
          <Select
            allowClear
            aria-label={BILLING_TERMS.provider.label}
            onChange={setProvider}
            options={BILLING_TERMS.provider.options}
            placeholder={BILLING_TERMS.provider.label}
            style={{ width: 150 }}
            value={provider}
          />
          <Select
            allowClear
            aria-label={BILLING_TERMS.platform.label}
            onChange={setPlatform}
            options={BILLING_TERMS.platform.options}
            placeholder={BILLING_TERMS.platform.label}
            style={{ width: 130 }}
            value={platform}
          />
          <Select
            allowClear
            aria-label={BILLING_TERMS.distribution.label}
            onChange={setDistribution}
            options={BILLING_TERMS.distribution.options}
            placeholder={BILLING_TERMS.distribution.label}
            style={{ width: 150 }}
            value={distribution}
          />
          <Select
            allowClear
            aria-label="订单状态"
            onChange={(value) => setStatus(value as BillingOrderStatus | undefined)}
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
            { title: "下单时间", dataIndex: "createdAt", width: 200, render: formatTimestampSeconds },
            { title: "用户 ID", dataIndex: "userId", width: 170, ellipsis: { showTitle: false }, render: renderOrderIdentifier },
            {
              title: "商品",
              width: 150,
              render: (_, order) => <Space direction="vertical" size={0}><strong>{billingProductLabel(order)}</strong><Typography.Text type="secondary">{order.productKey}</Typography.Text></Space>,
            },
            {
              title: "状态",
              width: 210,
              render: (_, order) => (
                <Tag color={billingStatusColor(order.paymentStatus)}>{billingStatusLabel(order.paymentStatus)}</Tag>
              ),
            },
            { title: "交易金额", width: 135, render: (_, order) => formatBillingMoney(order.amountMinor, order.currency) },
            { title: BILLING_TERMS.platform.label, dataIndex: "platform", width: 100, render: (value) => billingTermValue("platform", value) },
            { title: BILLING_TERMS.provider.label, dataIndex: "provider", width: 115, render: (value) => billingTermValue("provider", value) },
            { title: BILLING_TERMS.source.label, dataIndex: "purchaseSource", width: 115, render: (value) => billingTermValue("source", value) },
            { title: BILLING_TERMS.market.label, dataIndex: "market", width: 120, render: (value) => billingTermValue("market", value) },
            { title: "交易 ID", dataIndex: "providerTransactionId", ellipsis: { showTitle: false }, render: renderOrderIdentifier },
            { title: "操作", fixed: "right", width: 90, render: (_, order) => <Button size="small" onClick={() => void openOrder(order)}>详情</Button> },
          ]}
          dataSource={page?.items ?? []}
          loading={loading}
          pagination={false}
          rowKey="paymentId"
          locale={{ emptyText: <Empty description="暂无支付记录" /> }}
          scroll={{ x: 1520 }}
        />
        {page?.nextCursor ? (
          <div style={{ display: "flex", justifyContent: "center", paddingTop: 16 }}>
            <Button loading={loading} onClick={() => void loadOrders(filters, true, page.nextCursor ?? undefined)}>加载更多</Button>
          </div>
        ) : null}
      </section>

      <Drawer
        destroyOnClose
        onClose={() => { detailRequest.current++; setSelectedOrder(null); setEventsLoading(false); }}
        open={selectedOrder !== null}
        size="large"
        title="支付订单详情"
      >
        {detailLoading ? <div style={{ padding: 32, textAlign: "center" }}>加载中…</div> : detail ? (
          <Space direction="vertical" size="large" style={{ width: "100%" }}>
            <Descriptions bordered column={2} size="small" title="订单">
              <Descriptions.Item label="支付记录 ID">{detail.order.paymentId}</Descriptions.Item>
              <Descriptions.Item label="用户 ID">{detail.order.userId}</Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.provider.label}>{billingTermValue("provider", detail.order.provider)}</Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.market.label}>{billingTermValue("market", detail.order.market)}</Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.source.label}>{billingTermValue("source", detail.order.purchaseSource)}</Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.platform.label}>{billingTermValue("platform", detail.order.platform)}</Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.distribution.label}>{billingTermValue("distribution", detail.order.distribution)}</Descriptions.Item>
              <Descriptions.Item label="商品代号">{detail.order.productKey}</Descriptions.Item>
              <Descriptions.Item label="金额">{formatBillingMoney(detail.order.amountMinor, detail.order.currency)}</Descriptions.Item>
              <Descriptions.Item label="支付状态"><Tag color={billingStatusColor(detail.order.paymentStatus)}>{billingStatusLabel(detail.order.paymentStatus)}</Tag></Descriptions.Item>
              <Descriptions.Item label={BILLING_TERMS.environment.label}>{billingTermValue("environment", detail.order.environment)}</Descriptions.Item>
              <Descriptions.Item label="购买时间">{formatTimestamp(detail.order.paidAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="到期时间">{formatTimestamp(detail.order.expiresAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="账号删除标记">{formatTimestamp(detail.order.deletedAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="供应商交易 ID" span={2}>{detail.order.providerTransactionId}</Descriptions.Item>
              {detail.order.provider === "alipay" && <>
                <Descriptions.Item label="支付宝交易号" span={2}>{detail.order.providerOrderId ?? "—"}</Descriptions.Item>
                <Descriptions.Item label="支付订单 ID" span={2}>{detail.order.checkoutId ?? "—"}</Descriptions.Item>
              </>}
            </Descriptions>

            <Descriptions bordered column={2} size="small" title="当前会员状态">
              <Descriptions.Item label="有效">{detail.currentMembership ? detail.currentMembership.active ? "是" : "否" : "暂无同步记录"}</Descriptions.Item>
              <Descriptions.Item label="状态">{detail.currentMembership?.state ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="商品代号">{detail.currentMembership?.planKey ?? "—"}</Descriptions.Item>
              <Descriptions.Item label="到期">{formatTimestamp(detail.currentMembership?.expiresAt ?? undefined)}</Descriptions.Item>
              <Descriptions.Item label="续订状态"><BillingRenewalStatus value={detail.currentMembership?.revenueCatRenewalStatus} /></Descriptions.Item>
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
              <h3>支付事件时间线</h3>
              {detail.events.length ? <Timeline items={detail.events.map(eventTimelineItem)} /> : <Empty description="没有与此订单关联的支付事件" />}
              {detail.eventsNextCursor ? <Button loading={eventsLoading} onClick={() => void loadOlderEvents()}>加载更早事件</Button> : null}
            </section>
            <Alert showIcon type="info" message="当前会员状态显示的是最近一次同步结果，不代表这笔订单购买时的状态。支付通知记录为空，不代表支付失败。" />
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
