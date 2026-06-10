import { Button, Input, Select, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { adminApi } from "../lib/admin-api";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import {
  formatMailCallbackCellValue,
  MAIL_CALLBACK_EVENT_OPTIONS,
  resolveMailCallbackEventColor,
} from "../lib/mail-callback-events";
import { useAdminSession } from "../lib/admin-session";
import type { AdminEmailDeliveryEventItem, TencentSesEmailEvent } from "../lib/types";

export function MailCallbackEventsSection() {
  const { setNotice } = useAdminSession();
  const [items, setItems] = useState<AdminEmailDeliveryEventItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [event, setEvent] = useState<"" | TencentSesEmailEvent>("");
  const [email, setEmail] = useState("");

  const tableData = useMemo(() => items, [items]);

  async function loadEvents(nextEvent = event, nextEmail = email) {
    setLoading(true);
    try {
      const payload = await adminApi.getEmailDeliveryEvents({
        event: nextEvent || undefined,
        email: nextEmail.trim() || undefined,
        limit: 100,
      });
      setItems(payload.items);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadEvents("", "");
  }, []);

  return (
    <section className="surface-card">
      <div className="card-header">
        <div>
          <h2>回调记录</h2>
          <p>展示腾讯云 SES 投递、退信、打开、点击和退订等邮件反馈。</p>
        </div>
        <Button loading={loading} onClick={() => void loadEvents()} type="default">
          刷新
        </Button>
      </div>

      <div className="inline-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <Select
          aria-label="按邮件回调事件过滤"
          onChange={(value) => {
            const nextEvent = value as "" | TencentSesEmailEvent;
            setEvent(nextEvent);
            void loadEvents(nextEvent, email);
          }}
          options={MAIL_CALLBACK_EVENT_OPTIONS}
          style={{ minWidth: 180 }}
          value={event}
        />
        <Input.Search
          allowClear
          aria-label="按收件邮箱过滤"
          onSearch={(value) => {
            setEmail(value);
            void loadEvents(event, value);
          }}
          placeholder="按收件邮箱过滤"
          style={{ maxWidth: 320 }}
          value={email}
          onChange={(changeEvent) => setEmail(changeEvent.target.value)}
        />
      </div>

      <Table<AdminEmailDeliveryEventItem>
        dataSource={tableData}
        locale={{ emptyText: "暂无回调记录" }}
        loading={loading}
        pagination={{ pageSize: 10 }}
        rowKey="id"
        columns={[
          {
            title: "事件",
            dataIndex: "event",
            key: "event",
            render: (value: TencentSesEmailEvent) => <Tag color={resolveMailCallbackEventColor(value)}>{value}</Tag>,
          },
          { title: "收件人", dataIndex: "email", key: "email" },
          { title: "主题", dataIndex: "subject", key: "subject", render: formatMailCallbackCellValue },
          { title: "模板", dataIndex: "templateId", key: "templateId", render: formatMailCallbackCellValue },
          { title: "Message ID", dataIndex: "messageId", key: "messageId", render: formatMailCallbackCellValue },
          { title: "原因", dataIndex: "reason", key: "reason", render: formatMailCallbackCellValue },
          {
            title: "链接",
            dataIndex: "link",
            key: "link",
            render: (value?: string) => value ? <a href={value} rel="noreferrer" target="_blank">打开</a> : "—",
          },
          { title: "事件时间", dataIndex: "occurredAt", key: "occurredAt", render: formatTimestamp },
          { title: "接收时间", dataIndex: "receivedAt", key: "receivedAt", render: formatTimestamp },
        ]}
      />
    </section>
  );
}
