import { useBillingAccountRefreshViewModel } from "../lib/billing-account-refresh-view-model";
import { BillingBalanceMetrics } from "../components/billing-balance-metrics";
import { useNavigate } from "react-router";
import { BillingQueryStatus } from "../components/billing-query-status";
import { Alert, Button, Card, InputNumber, Space, Table, Tag, Tooltip, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { accountsApi, manualQueryApi, types, type Account, type Document } from "../lib/billing-accounts";
import { BillingAccountEditor } from "../components/billing-account-editor";
import { formatApiError, formatTimestamp } from "../lib/format";
export default function BalanceAccountsRoute() {
  const [doc, setDoc] = useState<Document>(); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  const [editing, setEditing] = useState<Account>(); const [open, setOpen] = useState(false);
  const loadGeneration = useRef(0);
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    try {
      const next = await accountsApi.get(AbortSignal.timeout(25000));
      if (generation === loadGeneration.current) { setDoc(next); setError(""); }
    } catch (e) { if (generation === loadGeneration.current) setError(`加载余额展示失败：${formatApiError(e)}`); }
  }, []);
  const refresh = useBillingAccountRefreshViewModel(load);
  useEffect(() => { void load(); }, [load]);
  async function run(action: () => Promise<unknown>) { setBusy(true); try { await action(); await load(); } catch (e) { setError(formatApiError(e)); } finally { setBusy(false); } }
  return <Space orientation="vertical" size="large" style={{ width: "100%" }}>
    <Typography.Title level={2}>余额与预警</Typography.Title>
    {error && <Alert type="error" title={error} />}
    {refresh.notice && <Alert type={refresh.notice.type} title={refresh.notice.text} />}
    <Card title="计费账号" extra={<Space><Button onClick={() => void load()}>刷新展示</Button><Tooltip title="刷新所有自动查询账号；需登录账号请逐个刷新"><Button aria-label="全部刷新" loading={refresh.refreshingAll} disabled={busy || refresh.refreshingIds.size > 0 || !doc?.accounts.some(a => a.mode === "automatic")} onClick={() => void refresh.refreshAll(doc?.accounts ?? [])}>全部刷新</Button></Tooltip><Button type="primary" onClick={() => { setEditing(undefined); setOpen(true); }}>新增账号</Button></Space>}>
      <Table<Account> rowKey="id" dataSource={doc?.accounts ?? []} pagination={false} scroll={{ x: 1000 }} columns={[
        { title: "账号", render: (_, a) => <>{a.name}<br /><Typography.Text type="secondary">{types[a.type]}</Typography.Text></> },
        { title: "模式", render: (_, a) => <Tag>{a.mode === "manual" ? "仅手动" : "自动查询"}</Tag> },
        { title: "余额", render: (_, a) => <BillingBalanceMetrics metrics={a.sample?.metrics} /> },
        { title: "状态", render: (_, a) => <BillingQueryStatus account={a} /> },
        { title: "最近成功", render: (_, a) => formatTimestamp(a.sample?.lastSuccessAt) },
        { title: "预警", render: (_, a) => a.mode === "manual" || !a.alerts ? "关闭" : ({ healthy: "正常", warning: "低余额", critical: "紧急" }[a.alert.level] ?? a.alert.level) },
        { title: "操作", render: (_, a) => <Space><Button onClick={() => { setEditing(a); setOpen(true); }}>编辑</Button>
          {a.mode === "automatic" ? <Button aria-label="刷新余额" loading={refresh.refreshingIds.has(a.id)} disabled={busy || refresh.refreshingAll} onClick={() => void refresh.refresh(a)}>刷新余额</Button> : <Space><Button disabled={busy} onClick={() => navigate(`/balance-accounts/${a.id}/login`)}>刷新余额</Button><Button disabled={busy} onClick={() => void run(() => manualQueryApi.clear(a.id))}>清除登录会话</Button></Space>}</Space> },
      ]} />
    </Card>
    {doc && <Card title="自动查询与预警设置" extra={<Button loading={busy} onClick={() => void run(() => accountsApi.settings(doc.config))}>保存设置</Button>}>
      <Space wrap>{([ ["intervalMinutes", "检查间隔（分钟）"], ["warningRepeatHours", "预警重复（小时）"], ["criticalRepeatHours", "紧急重复（小时）"], ["failureCount", "连续失败次数"], ["recoverySamples", "恢复样本数"] ] as const).map(([key, label]) => <label key={key}>{label} <InputNumber min={1} value={doc.config[key]} onChange={v => v !== null && setDoc({ ...doc, config: { ...doc.config, [key]: v } })} /></label>)}</Space>
    </Card>}
    <BillingAccountEditor accounts={doc?.accounts ?? []} providerOptions={doc?.providerOptions ?? []} account={editing} open={open} saving={busy} onCancel={() => setOpen(false)} onSave={v => void run(async () => { await accountsApi.save(v); setOpen(false); })} />
  </Space>;
}
