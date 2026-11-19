import { BillingLoginProgress } from "./billing-login-progress";
import { BillingLoginCredentials } from "./billing-login-credentials";
import { Alert, Button, Input, Card, Space, Typography } from "antd";
import { useRef } from "react";
import { types } from "../lib/billing-accounts";
import { useBillingLoginViewModel, type BillingLoginProps } from "../lib/billing-login-view-model";
export function BillingLoginWindow({ account, onClose, onChanged }: BillingLoginProps) {
  const { view, busy, error, text, setText, phase, reconnect, action } = useBillingLoginViewModel({ account, onClose, onChanged });
  const points = useRef<{ x: number; y: number }[]>([]);
  function point(event: React.PointerEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1119, Math.round((event.clientX - rect.left) * 1120 / rect.width))), y: Math.max(0, Math.min(759, Math.round((event.clientY - rect.top) * 760 / rect.height))) };
  }
  if (!account) return null;
  const controls = <Space><Button onClick={onClose}>关闭</Button><Button disabled={!view || busy} onClick={() => void action("view")}>刷新画面</Button><Button aria-label="登录完成，读取余额" type="primary" loading={busy} disabled={!view} onClick={() => void action("read")}>登录完成，读取余额</Button></Space>;
  return <Card title={`${account?.name ?? ""} · ${account ? types[account.type] : ""} · 登录并刷新余额`} extra={controls}>
    <BillingLoginProgress busy={busy} phase={phase} ready={Boolean(view)} />
    {error && <Alert type="error" title={error} action={!view && <Button disabled={busy} onClick={() => reconnect(value => value + 1)}>重新连接</Button>} />}
    <BillingLoginCredentials key={account?.id} busy={busy} ready={Boolean(view)} configured={view?.loginConfigured ?? account?.loginConfigured} onLogin={(username, password) => void action("input", { kind: "credentials", ...(username.trim() ? { username } : {}), ...(password ? { password } : {}) })} />
    <Typography.Paragraph>需要验证码时，在下方官方页面完成验证。</Typography.Paragraph>
    <details><summary>验证码与其他页面操作</summary>
    <Space wrap style={{ marginBottom: 12 }}>
      <Input.Password disabled={!view || busy} aria-label="验证码" autoComplete="new-password" value={text} onChange={e => setText(e.target.value)} onPressEnter={() => { if (text) { void action("input", { kind: "text", text }); setText(""); } }} placeholder="验证码" />
      <Button disabled={!view || busy || !text} onClick={() => { void action("input", { kind: "text", text }); setText(""); }}>输入到选中字段</Button>
      {[["Tab", "下一字段"], ["ControlOrMeta+A", "全选"], ["Backspace", "退格"], ["Enter", "回车"]].map(([key, label]) => <Button key={key} disabled={!view || busy} onClick={() => void action("input", { kind: "key", key })}>{label}</Button>)}
      <Button disabled={!view || busy} onClick={() => void action("input", { kind: "scroll", deltaY: -600 })}>向上滚动</Button>
      <Button disabled={!view || busy} onClick={() => void action("input", { kind: "scroll", deltaY: 600 })}>向下滚动</Button>
    </Space></details>
    {view && <img src={view.image} alt="官方账号登录窗口" draggable={false} style={{ display: "block", width: "100%", aspectRatio: "1120 / 760", objectFit: "contain", touchAction: "none", cursor: busy ? "wait" : "pointer", opacity: busy ? 0.65 : 1 }}
      onPointerDown={e => { if (busy) return; e.currentTarget.setPointerCapture(e.pointerId); points.current = [point(e)]; }}
      onPointerMove={e => { if (points.current.length && points.current.length < 79) points.current.push(point(e)); }}
      onPointerCancel={() => { points.current = []; }}
      onPointerUp={e => { if (!points.current.length) return; const path = [...points.current, point(e)]; points.current = []; void action("input", { kind: "pointer", points: path }); }} />}
  </Card>;
}
