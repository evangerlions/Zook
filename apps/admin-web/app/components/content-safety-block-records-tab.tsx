import { Button, Select, Table, Tag } from "antd";
import { useState } from "react";

import { JsonPreview } from "./json-preview";
import { adminApi } from "../lib/admin-api";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { useAdminSession } from "../lib/admin-session";
import type { AdminContentSafetyBlockRecordsDocument } from "../lib/types";

function getDateRange(range: string) {
  const days = range === "7d" ? 7 : 30;
  const now = new Date();
  const start = new Date(now.getTime() - (days - 1) * 24 * 60 * 60 * 1000);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: now.toISOString().slice(0, 10),
  };
}

export function ContentSafetyBlockRecordsTab() {
  const { clearNotice, setNotice } = useAdminSession();
  const [range, setRange] = useState("30d");
  const [source, setSource] = useState("");
  const [method, setMethod] = useState("");
  const [loading, setLoading] = useState(false);
  const [records, setRecords] = useState<AdminContentSafetyBlockRecordsDocument | null>(null);

  async function loadRecords() {
    setLoading(true);
    clearNotice();
    try {
      setRecords(await adminApi.listContentSafetyBlockRecords({
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
          <h3>拦截记录</h3>
          <p>展示被内容安全阻断的文本明文和命中的审核方式，数据默认保留 30 天。</p>
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
              { label: "关键词", value: "keyword" },
              { label: "LLM", value: "llm" },
              { label: "阿里云", value: "aliyun" },
            ]}
            value={method}
          />
          <Button loading={loading} onClick={() => void loadRecords()} type="primary">
            查询
          </Button>
        </div>
      </div>
      <Table
        className="content-safety-record-table"
        columns={[
          {
            title: "时间",
            dataIndex: "createdAt",
            render: (value: string) => formatTimestamp(value),
            width: 160,
          },
          {
            title: "来源",
            dataIndex: "source",
            render: (value: string) => <Tag>{value === "admin_test" ? "Admin 测试" : "业务"}</Tag>,
            width: 110,
          },
          {
            title: "方式",
            dataIndex: "method",
            render: (value: string) => (
              <Tag color={value === "keyword" ? "orange" : value === "llm" ? "purple" : "blue"}>{value}</Tag>
            ),
            width: 100,
          },
          {
            title: "分类",
            dataIndex: "category",
            render: (value?: string) => value || "-",
            width: 120,
          },
          {
            title: "Task Type",
            dataIndex: "taskType",
            render: (value?: string) => value || "-",
            width: 180,
          },
          {
            title: "拦截文本",
            dataIndex: "text",
            render: (value: string) => <div className="content-safety-block-text">{value}</div>,
          },
          {
            title: "长度",
            dataIndex: "textLength",
            width: 90,
          },
        ]}
        dataSource={records?.items ?? []}
        expandable={{
          expandedRowRender: (record) => (
            <JsonPreview
              value={{
                appId: record.appId,
                userId: record.userId,
                requestId: record.requestId,
                keywordId: record.keywordId,
                textHash: record.textHash,
                modelKey: record.modelKey,
                provider: record.provider,
                providerModel: record.providerModel,
                text: record.text,
              }}
            />
          ),
        }}
        loading={loading}
        pagination={{ pageSize: 10 }}
        rowKey="id"
      />
    </section>
  );
}
