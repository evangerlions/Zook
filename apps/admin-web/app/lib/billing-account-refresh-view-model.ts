import { useRef, useState } from "react";
import { accountsApi, type Account } from "./billing-accounts";
import { formatApiError } from "./format";
interface RefreshNotice { type: "success" | "warning" | "error"; text: string; }
/** Each mounted account list owns its in-flight refreshes; all queries use the existing account API. */
export function useBillingAccountRefreshViewModel(reload: () => Promise<void>) {
  const active = useRef(new Set<string>()); const bulk = useRef(false);
  const [refreshingIds, setRefreshingIds] = useState<ReadonlySet<string>>(new Set());
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [notice, setNotice] = useState<RefreshNotice>();
  async function query(account: Account): Promise<string | undefined> {
    active.current.add(account.id); setRefreshingIds(new Set(active.current));
    try {
      const sample = await accountsApi.refresh(account.id);
      if (sample.status !== "ok") return `${account.name}：${sample.detail ?? "查询失败"}`;
    } catch (error) { return `${account.name}：${formatApiError(error)}`; }
    finally { active.current.delete(account.id); setRefreshingIds(new Set(active.current)); }
  }
  async function refresh(account: Account) {
    if (bulk.current || active.current.has(account.id) || account.mode !== "automatic") return;
    setNotice(undefined);
    const failure = await query(account);
    await reload();
    if (failure) setNotice({ type: "error", text: failure });
  }
  async function refreshAll(accounts: Account[]) {
    const targets = accounts.filter(account => account.mode === "automatic");
    if (bulk.current || active.current.size || !targets.length) return;
    bulk.current = true; setRefreshingAll(true); setNotice(undefined);
    const failures: string[] = [];
    try {
      for (const account of targets) {
        const failure = await query(account);
        if (failure) failures.push(failure);
      }
      await reload();
      const skipped = accounts.length - targets.length;
      const summary = `已刷新 ${targets.length} 个账号，${failures.length} 个失败${skipped ? `；${skipped} 个需登录账号未刷新` : ""}`;
      setNotice({ type: failures.length ? "warning" : "success", text: failures.length ? `${summary}。${failures.join("；")}` : summary });
    } finally { bulk.current = false; setRefreshingAll(false); }
  }
  return { refreshingIds, refreshingAll, notice, refresh, refreshAll };
}
