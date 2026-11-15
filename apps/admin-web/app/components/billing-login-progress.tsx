import { Alert, Spin } from "antd";
export type LoginPhase = "opening" | "signing-in" | "reading" | "updating";
const phases: Record<LoginPhase, string> = { opening: "正在打开官方窗口并恢复登录状态…", "signing-in": "正在提交登录并检查是否需要验证…", reading: "正在使用当前登录会话查询余额…", updating: "正在更新官方页面…" };
export function BillingLoginProgress({ busy, phase, ready }: { busy: boolean; phase: LoginPhase; ready: boolean }) {
  return <Alert role="status" style={{ marginBottom: 16 }} type="info" showIcon icon={busy ? <Spin size="small" /> : undefined}
    title={busy ? phases[phase] : ready ? "官方页面已就绪，请查看下方登录状态；完成验证后读取余额。" : "连接未完成，可重新连接。"} />;
}
