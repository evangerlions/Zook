import { Alert, Button, Card, Input, Space } from "antd";
import { useEffect, useRef, useState } from "react";
import { requestJson, adminPath, ApiError } from "../lib/admin-api-client";
import { SensitiveOperationModal } from "./sensitive-operation-modal";
interface Summary {
  revision: number;
  configured: boolean;
  updated_at: string | null;
}
const path = adminPath("/apps/lighttick/market-providers/tushare-credential");
export function MarketCredentialsCard() {
  const [summary, setSummary] = useState<Summary | null>(null),
    [token, setToken] = useState(""),
    [pending, setPending] = useState<{
      body: { base_revision: number; token: string | null };
      key: string;
    } | null>(null),
    [auth, setAuth] = useState(false),
    [message, setMessage] = useState(""),
    [rejected, setRejected] = useState(false),
    [busy, setBusy] = useState(false),
    alive = useRef(true),
    gate = useRef(false),
    sent = useRef(false);
  async function load() {
    try {
      const value = await requestJson<Summary>(path);
      if (alive.current) setSummary(value);
    } catch {
      if (alive.current) setMessage("凭据状态读取失败，请恢复连接后核对。");
    }
  }
  useEffect(() => {
    alive.current = true;
    void load();
    return () => {
      alive.current = false;
    };
  }, []);
  async function send() {
    if (!pending || gate.current) return;
    gate.current = true;
    sent.current = true;
    setBusy(true);
    try {
      const r = await requestJson<Summary>(path, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": pending.key,
        },
        body: JSON.stringify(pending.body),
      });
      if (alive.current) {
        setSummary(r);
        setToken("");
        setPending(null);
        setMessage("凭据已更新；密钥内容不会返回到浏览器。");
        setRejected(false);
      }
    } catch (e) {
      if (alive.current) {
        setRejected(
          e instanceof ApiError && [400, 403, 409, 422].includes(e.statusCode),
        );
        setMessage(
          "本次提交尚未确认或已被拒绝。原请求仅保存在此页内存；请核对后重试原请求。",
        );
      }
      throw e;
    } finally {
      gate.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function prepare(clear: boolean) {
    sent.current = false;
    if (!summary || pending || busy || (!clear && !token.trim())) return;
    setPending({
      key: crypto.randomUUID(),
      body: { base_revision: summary.revision, token: clear ? null : token },
    });
    setRejected(false);
    setAuth(true);
  }
  return (
    <Card title="行情供应商凭据">
      <Space direction="vertical" style={{ width: "100%" }}>
        <p>
          当前凭据修订 {summary?.revision ?? "待读取"} ·{" "}
          {summary?.configured ? "已配置 Tushare" : "未配置 Tushare"}
          。供应商开关沿用项目版本化配置，失败不会自动换源。
        </p>
        <Alert
          type="info"
          showIcon
          message="密钥只留服务端"
          description="输入仅保存在当前页内存，不写本机存储；未知结果请保留此页并重试原请求。关闭页面后请重新核对修订。"
        />
        {message && <Alert message={message} type="warning" />}
        <Input.Password
          aria-label="新的 Tushare Token"
          autoComplete="off"
          value={token}
          disabled={!!pending || busy}
          onChange={(e) => setToken(e.target.value)}
          placeholder="输入新的 Tushare Token"
        />
        <Space wrap>
          <Button onClick={() => void load()}>核对凭据状态</Button>
          <Button
            disabled={!summary || !!pending || busy || !token.trim()}
            onClick={() => prepare(false)}
          >
            更新 Tushare 凭据
          </Button>
          <Button
            danger
            disabled={!summary || !!pending || busy || !summary.configured}
            onClick={() => prepare(true)}
          >
            移除 Tushare 凭据
          </Button>
          {pending && (
            <Button disabled={busy} onClick={() => setAuth(true)}>
              重试凭据原请求
            </Button>
          )}
          {pending && rejected && (
            <Button
              disabled={busy}
              onClick={() => {
                setPending(null);
                setRejected(false);
              }}
            >
              已核对修订，解除原请求
            </Button>
          )}
        </Space>
      </Space>
      <SensitiveOperationModal
        open={auth}
        operation="lighttick.market.credentials.write"
        title="确认更新服务端行情凭据"
        description="按已核对的凭据修订提交，不返回密钥明文。"
        onClose={() => {
          setAuth(false);
          if (!sent.current) setPending(null);
        }}
        onAuthorized={send}
      />
    </Card>
  );
}
