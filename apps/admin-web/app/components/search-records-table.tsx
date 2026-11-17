import { Table, Typography } from "antd";
import type { SearchRecord } from "../lib/admin-search-api";
import { JsonPreview } from "./json-preview";

export function SearchRecordDetails({ record }: { record: SearchRecord }) {
  return <div>
      <Typography.Title level={5}>输入</Typography.Title>
      {record.input ? <JsonPreview value={record.input} /> : "历史记录未保存输入"}
      <Typography.Title level={5}>输出</Typography.Title>
      {record.output ? <JsonPreview value={record.output} /> : "历史记录未保存输出"}
    </div>;
}

export function SearchRecordsTable({ records }: { records: SearchRecord[] }) {
  return <Table rowKey="requestId" dataSource={records} scroll={{ x: 1000 }} expandable={{
    expandedRowRender: record => <SearchRecordDetails record={record} />,
  }} columns={[
    { title: "时间", dataIndex: "timestamp" },
    { title: "用户", dataIndex: "userId", filters: [...new Set(records.map(x => x.userId))].map(value => ({ text: value, value })), onFilter: (value, record) => record.userId === value },
    { title: "搜索词", render: (_, record) => record.input?.query ?? "—" },
    { title: "场景", dataIndex: "sceneKey" }, { title: "状态", dataIndex: "status" }, { title: "原因", dataIndex: "code" },
    { title: "上游次数", dataIndex: "upstreamCalls" }, { title: "返回条数", dataIndex: "returnedCount" }, { title: "过滤条数", dataIndex: "filteredCount" }, { title: "耗时 ms", dataIndex: "latencyMs" }, { title: "Request ID", dataIndex: "requestId" },
  ]} />;
}
