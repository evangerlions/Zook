import { Alert, Button, Spin, Space } from "antd";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { BillingLoginWindow } from "../components/billing-login-window";
import { accountsApi, type Account } from "../lib/billing-accounts";
import { formatApiError } from "../lib/format";
export default function BalanceAccountLoginRoute() {
  const { accountId } = useParams(); const navigate = useNavigate();
  const [account, setAccount] = useState<Account>(); const [error, setError] = useState("");
  useEffect(() => {
    let active = true; const controller = new AbortController(); setAccount(undefined); setError("");
    void accountsApi.get(AbortSignal.any([controller.signal, AbortSignal.timeout(25000)])).then(doc => {
      if (!active) return;
      const found = doc.accounts.find(a => a.id === accountId && a.mode === "manual");
      if (found) setAccount(found); else setError("未找到可登录的计费账号。");
    }).catch(e => { if (active) setError(formatApiError(e)); });
    return () => { active = false; controller.abort(); };
  }, [accountId]);
  const close = () => navigate("/balance-accounts");
  if (error) return <Alert type="error" title={error} action={<Button onClick={close}>返回</Button>} />;
  if (!account) return <Space><Spin aria-label="正在加载计费账号" /><Button onClick={close}>返回</Button></Space>;
  return <BillingLoginWindow account={account} onClose={close} onChanged={() => {}} />;
}
