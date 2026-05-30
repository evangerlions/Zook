import { Button, Input, Segmented, Select, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Field, ToggleField } from "../components/field";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { ApiError, adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminSmsServiceDocument,
  AdminSmsVerificationItem,
  AdminSmsVerificationListDocument,
  AdminSmsVerificationRevealDocument,
  SmsServiceConfig,
} from "../lib/types";

const SMS_REVEAL_OPERATION = "sms.verification.reveal";
const SMS_TAB_OPTIONS: Array<{ label: string; value: "config" | "records" }> = [
  { label: "配置", value: "config" },
  { label: "发送记录", value: "records" },
];

function createDefaultSmsConfig(): SmsServiceConfig {
  return {
    enabled: false,
    sdkAppId: "",
    templateId: "",
    signName: "",
    region: "ap-beijing",
  };
}

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
  const [tab, setTab] = useState<"config" | "records">("config");
  const [configDocument, setConfigDocument] = useState<AdminSmsServiceDocument | null>(null);
  const [configDraft, setConfigDraft] = useState<SmsServiceConfig>(createDefaultSmsConfig());
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
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

  async function loadConfig() {
    setConfigLoading(true);
    try {
      const payload = await adminApi.getSmsService();
      setConfigDocument(payload);
      setConfigDraft(payload.config);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setConfigLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
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

  async function saveConfig() {
    setConfigSaving(true);
    clearNotice();
    try {
      const payload = await adminApi.updateSmsService({
        ...configDraft,
        desc: "更新短信服务配置",
      });
      setConfigDocument(payload);
      setConfigDraft(payload.config);
      setNotice(makeNotice("success", "短信服务配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setConfigSaving(false);
    }
  }

  function updateConfigField<K extends keyof SmsServiceConfig>(
    key: K,
    value: SmsServiceConfig[K],
  ) {
    setConfigDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>SMS</h1>
          <p>配置腾讯云短信验证码参数，并查看最近 7 天短信验证码发送记录。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{configDocument?.revision ? `R${configDocument.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(configDocument?.updatedAt)}</span>
        </div>
      </header>

      <div className="tab-row">
        <Segmented
          className="page-segmented"
          onChange={(value) => setTab(value as "config" | "records")}
          options={SMS_TAB_OPTIONS}
          value={tab}
        />
      </div>

      {tab === "config" ? (
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>腾讯云短信配置</h2>
              <p>SecretId / SecretKey 继续使用 PASSWORDS 中的 `tencent.secret_id` 与 `tencent.secret_key`。</p>
            </div>
            <div className="top-actions">
              <Button loading={configLoading} onClick={() => void loadConfig()}>
                刷新
              </Button>
              <Button loading={configSaving} onClick={() => void saveConfig()} type="primary">
                保存
              </Button>
            </div>
          </div>

          <div className="stack">
            <ToggleField
              checked={configDraft.enabled}
              hint="开启后，真实短信发送优先使用这里保存的参数；关闭时继续使用启动环境变量。"
              label="启用 Admin SMS 配置"
              onChange={(value) => updateConfigField("enabled", value)}
            />

            <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
              <Field label="TENCENT_SMS_SDK_APP_ID">
                <Input
                  onChange={(event) => updateConfigField("sdkAppId", event.target.value)}
                  placeholder="1400..."
                  size="large"
                  value={configDraft.sdkAppId}
                />
              </Field>
              <Field label="TENCENT_SMS_TEMPLATE_ID">
                <Input
                  onChange={(event) => updateConfigField("templateId", event.target.value)}
                  placeholder="190..."
                  size="large"
                  value={configDraft.templateId}
                />
              </Field>
              <Field label="TENCENT_SMS_SIGN_NAME">
                <Input
                  onChange={(event) => updateConfigField("signName", event.target.value)}
                  placeholder="短信签名"
                  size="large"
                  value={configDraft.signName}
                />
              </Field>
              <Field hint="默认 ap-beijing；一般不需要改。" label="Region">
                <Input
                  onChange={(event) => updateConfigField("region", event.target.value)}
                  placeholder="ap-beijing"
                  size="large"
                  value={configDraft.region}
                />
              </Field>
            </div>
          </div>
        </section>
      ) : (
        <>
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
        </>
      )}

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
