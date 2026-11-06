import { Alert, Button, Card, Input, InputNumber, Modal, Radio, Space, message } from "antd";
import { useRef, useState } from "react";
import { ApiError } from "../../lib/admin-api-client";
import { grantCredits, searchCreditUsers, type CreditUserCandidate, type CreditUserSearchField } from "../../lib/ai-novel-credit-admin-api";
import { CreditSelectedUser, CreditUserResults } from "./credit-user-results";
import { CreditGrantPresets } from "./credit-grant-presets";

type Grant = { uid: string; points: number; idempotencyKey: string };
const pendingKey = "zook.admin.pending-credit-grant";
function readPending(): Grant | undefined {
  if (typeof window === "undefined") return undefined;
  try { const value = sessionStorage.getItem(pendingKey); return value ? JSON.parse(value) as Grant : undefined; }
  catch { return undefined; }
}
function savePending(value?: Grant) {
  if (value) sessionStorage.setItem(pendingKey, JSON.stringify(value));
  else sessionStorage.removeItem(pendingKey);
}
export function CreditGrantForm({ onGranted }: { onGranted: () => void }) {
  const [field, setField] = useState<CreditUserSearchField>("uid");
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState<CreditUserCandidate[]>([]);
  const [selected, setSelected] = useState<string>();
  const [points, setPoints] = useState<number | null>(null);
  const [error, setError] = useState<string>();
  const [tooMany, setTooMany] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Grant | undefined>(readPending);
  const generation = useRef(0);
  const confirming = useRef(false);
  function reset() { generation.current++; setUsers([]); setSelected(undefined); setSearched(false); setSearching(false); setTooMany(false); setError(undefined); }
  async function search() {
    const id = ++generation.current; setSearching(true); setSelected(undefined); setError(undefined); setSearched(false);
    try {
      const result = await searchCreditUsers(field, query);
      if (id !== generation.current) return;
      setUsers(result.users); setTooMany(result.tooMany); setSearched(true);
    } catch (e) { if (id === generation.current) setError(e instanceof Error ? e.message : "查询失败"); }
    finally { if (id === generation.current) setSearching(false); }
  }
  async function execute(command: Grant) {
    savePending(command); setPending(command); setBusy(true); setError(undefined);
    try {
      await grantCredits(command); savePending(); setPending(undefined); setPoints(null); message.success("发放成功"); onGranted();
    } catch (e) { if (e instanceof ApiError && e.statusCode >= 400 && e.statusCode < 500) { savePending(); setPending(undefined); } setError(e instanceof Error ? e.message : "发放失败，请重试"); }
    finally { setBusy(false); }
  }
  function confirm() {
    if (confirming.current || !selected || !points || !Number.isSafeInteger(points) || points <= 0) return;
    confirming.current = true;
    const command = { uid: selected, points, idempotencyKey: crypto.randomUUID() };
    Modal.confirm({ title: "确认发放创作点？", content: `用户 ${selected}，发放 ${points} 点。`, okText: "发放", cancelText: "取消", onCancel: () => { confirming.current = false; }, onOk: async () => { try { await execute(command); } finally { confirming.current = false; } } });
  }
  return <Card title="发放创作点">
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Radio.Group value={field} disabled={!!pending || busy} onChange={e => { setField(e.target.value); reset(); }} options={[{ label: "UID", value: "uid" }, { label: "手机号", value: "phone" }, { label: "邮箱", value: "email" }]} />
      <Input.Search aria-label="搜索用户" value={query} disabled={!!pending || busy} loading={searching} onChange={e => { setQuery(e.target.value); reset(); }} onSearch={() => void search()} enterButton="搜索" />
      {tooMany && <Alert type="warning" message="匹配用户超过 10 个，请输入更具体的内容。" />}
      {searched && !tooMany && users.length === 0 && <Alert type="info" message="没有匹配的用户。" />}
      {users.length > 0 && <CreditUserResults users={users} selected={selected} disabled={!!pending || busy} onSelect={setSelected} />}
      <Space wrap><InputNumber aria-label="发放点数" min={1} precision={0} value={points} disabled={!!pending || busy} onChange={v => setPoints(v)} placeholder="点数" /><Button type="primary" disabled={!selected || !points || !!pending} loading={busy} onClick={confirm}>发放</Button>{pending && <Button loading={busy} onClick={() => void execute(pending)}>重试发放</Button>}<CreditSelectedUser user={users.find(user => user.uid === selected)} /></Space>
      <CreditGrantPresets points={points} disabled={!!pending || busy} onSelect={setPoints} />
      {pending && <Alert type="warning" message={`待确认：用户 ${pending.uid}，${pending.points} 点。请重试确认结果。`} />}
      {error && <Alert type="error" message={error} showIcon />}
    </Space>
  </Card>;
}
