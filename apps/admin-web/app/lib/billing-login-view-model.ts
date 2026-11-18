import { useEffect, useRef, useState } from "react";
import { manualQueryApi, type Account, type BrowserInput, type LoginView } from "./billing-accounts";
import { formatApiError } from "./format";
import type { LoginPhase } from "../components/billing-login-progress";
export interface BillingLoginProps { account?: Account; onClose(): void; onChanged(): void; }
export function useBillingLoginViewModel({ account, onClose, onChanged }: BillingLoginProps) {
  const [view, setView] = useState<LoginView>(); const [busy, setBusy] = useState(false); const [text, setText] = useState(""); const [error, setError] = useState("");
  const [phase, setPhase] = useState<LoginPhase>("opening");
  const [connectionAttempt, reconnect] = useState(0);
  const current = useRef<{ accountId: string; sessionId: string } | undefined>(undefined);
  useEffect(() => {
    if (!account) return;
    let cancelled = false; setView(undefined); setError(""); setText(""); setBusy(true); setPhase("opening");
    void manualQueryApi.start(account.id).then(v => {
      if (cancelled) { void manualQueryApi.action(account.id, v.sessionId, "close").catch(() => {}); return; }
      current.current = { accountId: account.id, sessionId: v.sessionId };
      if (v.completed) { onChanged(); onClose(); return; }
      setView(v); if (v.notice) setError(v.notice);
    }).catch(e => { if (!cancelled) setError(loginError(e)); }).finally(() => { if (!cancelled) setBusy(false); });
    return () => {
      cancelled = true; const session = current.current; current.current = undefined;
      if (session) void manualQueryApi.action(session.accountId, session.sessionId, "close").catch(() => {});
    };
  }, [account?.id, connectionAttempt]);
  async function action(operation: "view" | "input" | "read", input?: BrowserInput) {
    if (!account || !view || busy) return;
    const originSession = view.sessionId;
    const stillCurrent = () => current.current?.sessionId === originSession;
    setBusy(true); setError(""); setPhase(operation === "read" ? "reading" : operation === "input" && input?.kind === "credentials" ? "signing-in" : "updating");
    try {
      if (operation === "read") {
        const result = await manualQueryApi.action<{ sample: { status: string; detail?: string } }>(account.id, view.sessionId, "read");
        if (!stillCurrent()) return;
        onChanged();
        if (result.sample.status === "ok") onClose();
        else setError(result.sample.detail ?? "未识别到唯一余额，请打开套餐用量页面后重试");
      } else { const next = await manualQueryApi.action<LoginView>(account.id, view.sessionId, operation, input); if (stillCurrent()) { setView(next); if (next.notice) setError(next.notice); if (next.completed) { onChanged(); onClose(); } } }
    } catch (failure) { if (stillCurrent()) setError(loginError(failure)); }
    finally { if (stillCurrent()) setBusy(false); }
  }
  return { view, busy, error, text, setText, phase, reconnect, action };
}

function loginError(error: unknown) {
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) return "官网响应超时，请刷新画面或重新连接。";
  return formatApiError(error);
}
