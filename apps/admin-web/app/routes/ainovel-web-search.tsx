import { Button, Card, Form, Input, InputNumber, Select, Space, Switch, Table, Tabs, Tag, Alert, Popconfirm } from "antd";
import { useEffect, useState } from "react";
import { searchApi, type SearchConfig, type SearchConfigDocument, type SearchRecord } from "../lib/admin-search-api";
import { formatApiError } from "../lib/format";
import { SearchRecordsTable } from "../components/search-records-table";

export default function AiNovelWebSearchRoute() {
  const [document, setDocument] = useState<SearchConfigDocument>();
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<SearchConfig & { desc: string }>();
  const [testForm] = Form.useForm<{ query: string; region: string }>();
  const [testStatus, setTestStatus] = useState("");
  async function run(action: () => Promise<void>) {
    setBusy(true); setError("");
    try { await action(); } catch (e) { setError(formatApiError(e)); } finally { setBusy(false); }
  }
  function show(next: SearchConfigDocument) { setDocument(next); form.setFieldsValue(next.config); }
  async function reload() { await run(async () => { const [config, usage] = await Promise.all([searchApi.config(), searchApi.records()]); show(config); setRecords(usage.items); }); }
  useEffect(() => { void reload(); }, []);
  return <Space direction="vertical" style={{ width: "100%" }}>
    <Space><h2>联网搜索 · DeepSeek</h2><Button onClick={() => void reload()} loading={busy}>刷新</Button></Space>
    {error && <Alert type="error" message={error} showIcon />}
    <Tabs items={[
      { key: "config", label: "配置", children: <Card loading={!document && busy}>
        <Form form={form} layout="vertical" onFinish={values => void run(async () => { const { desc, ...config } = values; show(await searchApi.save(config, desc)); })}>
          <Form.Item name="enabled" label="启用搜索" valuePropName="checked"><Switch /></Form.Item>
          <Form.Item name="regions" label="开放区域" rules={[{ required: true }]}><Select mode="multiple" options={[{ value: "CN", label: "CN" }, { value: "GLOBAL", label: "GLOBAL" }]} /></Form.Item>
          <Form.Item name="secretRef" label="Password 密钥引用" rules={[{ required: true }]}><Input placeholder="{{zook.ps.deepseek.web_search_api_key}}" /></Form.Item>
          <Space align="start" wrap>
            <Form.Item name="dailyLimit" label="每用户每日尝试次数" rules={[{ required: true }]}><InputNumber min={1} max={10000} precision={0} /></Form.Item>
            <Form.Item name="concurrentLimit" label="每用户并发数" rules={[{ required: true }]}><InputNumber min={1} max={10} precision={0} /></Form.Item>
            <Form.Item name="maxResults" label="最多内部结果数" rules={[{ required: true }]}><InputNumber min={1} max={5} precision={0} /></Form.Item>
            <Form.Item name="upstreamTimeoutMs" label="上游超时（毫秒）" rules={[{ required: true }]}><InputNumber min={100} max={30000} precision={0} /></Form.Item>
            <Form.Item name="totalTimeoutMs" label="总超时（毫秒）" rules={[{ required: true }]}><InputNumber min={100} max={60000} precision={0} /></Form.Item>
          </Space>
          <Form.Item name="desc" label="变更说明"><Input /></Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>保存</Button>
        </Form>
        <Table size="small" rowKey="revision" dataSource={document?.revisions ?? []} columns={[
          { title: "版本", dataIndex: "revision" }, { title: "时间", dataIndex: "createdAt" }, { title: "说明", dataIndex: "desc" },
          { title: "操作", render: (_, row) => <Popconfirm title="恢复此版本的搜索配置？" okText="恢复" cancelText="取消" onConfirm={() => run(async () => show(await searchApi.restore(row.revision)))}><Button disabled={busy}>恢复</Button></Popconfirm> },
        ]} />
      </Card> },
      { key: "test", label: "测试", children: <Card>
        <Form form={testForm} initialValues={{ region: "CN" }} layout="vertical" onFinish={values => void run(async () => { const result = await searchApi.test(values.query, values.region); setTestStatus(result.code ? `${result.status} · ${result.code}` : result.status); testForm.resetFields(["query"]); })}>
          <Form.Item name="query" label="搜索词" rules={[{ required: true }]}><Input /></Form.Item>
          <Form.Item name="region" label="区域"><Select options={[{ value: "CN" }, { value: "GLOBAL" }]} /></Form.Item>
          <Button htmlType="submit" type="primary" loading={busy}>测试</Button>
        </Form>
        {testStatus && <Tag>{testStatus}</Tag>}
      </Card> },
      { key: "records", label: "调用记录", children: <SearchRecordsTable records={records} /> },
    ]} />
  </Space>;
}
