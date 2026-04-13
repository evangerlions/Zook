import { Button, Select, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { ApiError, adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminSmsVerificationItem,
  AdminSmsVerificationListDocument,
  AdminSmsVerificationRevealDocument,
} from "../lib/types";

const SMS_REVEAL_OPERATION = "sms.verification.reveal";

function sceneLabel(scene: AdminSmsVerificationItem["scene"]) {
  switch (scene) {
    case "login":
      return "登录";
    case "register":
      return "注册";
    case "password-reset":
      return "重置密码";
  }
}

export default function SmsRoute() {
  const { apps, clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] = useState<AdminSmsVerificationListDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedAppId, setSelectedAppId] = useState<string>("");
  const [revealLoadingId, setRevealLoadingId] = useState<string>("");
  const [pendingRevealId, setPendingRevealId] = useState<string>("");
  const [revealed, setRevealed] = useState<AdminSmsVerificationRevealDocument | null>(null);

  async function loadData(nextAppId = selectedAppId) {
    setLoading(true);
    try {
      const payload = await adminApi.getSmsVerifications(nextAppId || undefined);
      setDocument(payload);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData("");
  }, []);

  const options = useMemo(
    () => [
      { label: "全部 App", value: "" },
      ...apps.map((item) => ({ label: `${item.appName} · ${item.appId}`, value: item.appId })),
    ],
    [apps],
  );

  async function reveal(recordId: string, allowPrompt = true) {
    setRevealLoadingId(recordId);
    clearNotice();
    try {
      const payload = await adminApi.revealSmsVerification(recordId);
      setRevealed(payload);
      setPendingRevealId("");
      setNotice(makeNotice("success", `验证码已显示（App ${payload.item.appId}）。`));
      await loadData(selectedAppId);
    } catch (error) {
      if (allowPrompt && error instanceof ApiError && error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED") {
        setPendingRevealId(recordId);
        return;
      }
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRevealLoadingId("");
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>SMS</h1>
          <p>查看最近 7 天短信验证码记录，默认展示掩码元数据；验证码需通过受控 reveal 查看。</p>
        </div>
      </header>

      <section className="surface-card">
        <div className="inline-row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <Select
            aria-label="按 appid 过滤短信验证码记录"
            onChange={(value) => {
              setSelectedAppId(value);
              void loadData(value);
            }}
            options={options}
            style={{ minWidth: 280 }}
            value={selectedAppId}
          />
          <Button onClick={() => void loadData(selectedAppId)} type="default">
            刷新
          </Button>
        </div>
      </section>

      <section className="surface-card">
        <Table<AdminSmsVerificationItem>
          dataSource={document?.items ?? []}
          loading={loading}
          pagination={{ pageSize: 10 }}
          rowKey="id"
          columns={[
            { title: "AppId", dataIndex: "appId", key: "appId" },
            { title: "手机号", dataIndex: "phoneMasked", key: "phoneMasked" },
            { title: "场景", dataIndex: "scene", key: "scene", render: (value) => sceneLabel(value) },
            { title: "模式", dataIndex: "isTest", key: "isTest", render: (value) => value ? <Tag color="blue">test=true</Tag> : <Tag color="gold">real</Tag> },
            { title: "状态", dataIndex: "status", key: "status", render: (value) => <Tag>{value}</Tag> },
            { title: "发送时间", dataIndex: "sentAt", key: "sentAt", render: (value) => formatTimestamp(value) },
            { title: "过期时间", dataIndex: "expiresAt", key: "expiresAt", render: (value) => formatTimestamp(value) },
            { title: "已 reveal 次数", dataIndex: "revealCount", key: "revealCount" },
            {
              title: "操作",
              key: "actions",
              render: (_, item) => (
                <Button
                  data-testid={`sms-reveal-${item.id}`}
                  loading={revealLoadingId === item.id}
                  onClick={() => void reveal(item.id)}
                  type="primary"
                >
                  查看验证码
                </Button>
              ),
            },
          ]}
        />
      </section>

      {revealed ? (
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>最近一次 reveal</h2>
              <p>此区域展示最近一次受控 reveal 的结果。</p>
            </div>
          </div>
          <div className="stack">
            <div className="inline-row"><strong>AppId:</strong><span>{revealed.item.appId}</span></div>
            <div className="inline-row"><strong>手机号:</strong><span>{revealed.item.phoneMasked}</span></div>
            <div className="inline-row"><strong>状态:</strong><span>{revealed.item.status}</span></div>
            <div className="inline-row"><strong>验证码:</strong><code data-testid="sms-revealed-code">{revealed.code}</code></div>
            <div className="inline-row"><strong>Revealed At:</strong><span>{formatTimestamp(revealed.revealedAt)}</span></div>
          </div>
        </section>
      ) : null}

      <SensitiveOperationModal
        description="为了查看短信验证码明文，需要先输入 6 位二级密码。"
        onAuthorized={async () => {
          if (!pendingRevealId) return;
          await reveal(pendingRevealId, false);
        }}
        onClose={() => setPendingRevealId("")}
        open={Boolean(pendingRevealId)}
        operation={SMS_REVEAL_OPERATION}
        title="验证后查看验证码"
      />
    </section>
  );
}
