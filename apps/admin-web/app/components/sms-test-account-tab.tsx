import { Button, Input, Modal, Select, Table, Tag } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Field, ToggleField } from "./field";
import { SensitiveOperationModal } from "./sensitive-operation-modal";
import { ApiError } from "../lib/admin-api";
import { adminTestAccountApi } from "../lib/admin-test-account-api";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminAppSummary,
  AdminTestAccountDocument,
  AdminTestAccountItem,
  AdminTestAccountRevealDocument,
} from "../lib/types";

const TEST_ACCOUNT_REVEAL_OPERATION = "test_account.code.reveal";

interface Draft {
  id?: string;
  appId: string;
  phoneNa: string;
  phone: string;
  label: string;
  enabled: boolean;
}

const EMPTY_DRAFT: Draft = {
  appId: "ai_novel",
  phoneNa: "+86",
  phone: "",
  label: "",
  enabled: true,
};

function toLocalPhone(item: AdminTestAccountItem): string {
  return item.phone.startsWith(item.phoneNa)
    ? item.phone.slice(item.phoneNa.length)
    : item.phone;
}

export function SmsTestAccountTab({
  apps,
  setNotice,
  clearNotice,
}: {
  apps: AdminAppSummary[];
  setNotice: (notice: ReturnType<typeof makeNotice>) => void;
  clearNotice: () => void;
}) {
  const [document, setDocument] = useState<AdminTestAccountDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [editorOpen, setEditorOpen] = useState(false);
  const [pendingRevealId, setPendingRevealId] = useState("");
  const [revealed, setRevealed] = useState<AdminTestAccountRevealDocument | null>(null);
  const [actionId, setActionId] = useState("");

  const appOptions = useMemo(
    () => apps.map((item) => ({ label: `${item.appName} · ${item.appId}`, value: item.appId })),
    [apps],
  );

  async function loadData() {
    setLoading(true);
    try {
      setDocument(await adminTestAccountApi.getTestAccounts());
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  function openCreate() {
    setDraft({
      ...EMPTY_DRAFT,
      appId: apps.some((item) => item.appId === "ai_novel") ? "ai_novel" : apps[0]?.appId ?? "",
    });
    setEditorOpen(true);
  }

  function openEdit(item: AdminTestAccountItem) {
    setDraft({
      id: item.id,
      appId: item.appId,
      phoneNa: item.phoneNa,
      phone: toLocalPhone(item),
      label: item.label,
      enabled: item.enabled,
    });
    setEditorOpen(true);
  }

  async function saveDraft() {
    setSaving(true);
    clearNotice();
    try {
      const input = {
        appId: draft.appId,
        phoneNa: draft.phoneNa,
        phone: draft.phone,
        label: draft.label,
        enabled: draft.enabled,
      };
      const payload = draft.id
        ? await adminTestAccountApi.updateTestAccount(draft.id, input)
        : await adminTestAccountApi.createTestAccount(input);
      setDocument(payload);
      setEditorOpen(false);
      setNotice(makeNotice("success", draft.id ? "测试账号已更新。" : "测试账号已创建。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(item: AdminTestAccountItem) {
    setActionId(item.id);
    clearNotice();
    try {
      setDocument(await adminTestAccountApi.updateTestAccount(item.id, {
        appId: item.appId,
        phoneNa: item.phoneNa,
        phone: toLocalPhone(item),
        label: item.label,
        enabled: !item.enabled,
      }));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setActionId("");
    }
  }

  async function resetCode(item: AdminTestAccountItem) {
    setActionId(item.id);
    clearNotice();
    try {
      setDocument(await adminTestAccountApi.resetTestAccountCode(item.id));
      setRevealed(null);
      setNotice(makeNotice("success", "验证码已重置，请 reveal 后复制新的验证码。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setActionId("");
    }
  }

  async function deleteAccount(item: AdminTestAccountItem) {
    setActionId(item.id);
    clearNotice();
    try {
      setDocument(await adminTestAccountApi.deleteTestAccount(item.id));
      if (revealed?.item.id === item.id) {
        setRevealed(null);
      }
      setNotice(makeNotice("success", "测试账号已删除。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setActionId("");
    }
  }

  async function revealCode(accountId: string, allowPrompt = true) {
    setActionId(accountId);
    clearNotice();
    try {
      const payload = await adminTestAccountApi.revealTestAccountCode(accountId);
      setRevealed(payload);
      setPendingRevealId("");
      setNotice(makeNotice("success", "验证码已显示。"));
    } catch (error) {
      if (allowPrompt && error instanceof ApiError && error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED") {
        setPendingRevealId(accountId);
        return;
      }
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setActionId("");
    }
  }

  return (
    <>
      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>Test Account</h2>
            <p>为 App Store Review 配置固定手机号与静态验证码，Reviewer 仍使用 App 内短信登录入口。</p>
          </div>
          <div className="top-actions">
            <Button loading={loading} onClick={() => void loadData()}>
              刷新
            </Button>
            <Button onClick={openCreate} type="primary">
              新建测试账号
            </Button>
          </div>
        </div>

        <Table<AdminTestAccountItem>
          dataSource={document?.items ?? []}
          loading={loading}
          pagination={{ pageSize: 10 }}
          rowKey="id"
          columns={[
            { title: "AppId", dataIndex: "appId", key: "appId" },
            { title: "手机号", dataIndex: "phoneMasked", key: "phoneMasked" },
            { title: "标签", dataIndex: "label", key: "label", render: (value) => value || "App Review" },
            {
              title: "状态",
              dataIndex: "enabled",
              key: "enabled",
              render: (value) => value ? <Tag color="green">enabled</Tag> : <Tag>disabled</Tag>,
            },
            { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt", render: (value) => formatTimestamp(value) },
            {
              title: "操作",
              key: "actions",
              render: (_, item) => (
                <div className="inline-row">
                  <Button onClick={() => openEdit(item)}>编辑</Button>
                  <Button loading={actionId === item.id} onClick={() => void toggleEnabled(item)}>
                    {item.enabled ? "停用" : "启用"}
                  </Button>
                  <Button loading={actionId === item.id} onClick={() => void revealCode(item.id)} type="primary">
                    查看验证码
                  </Button>
                  <Button loading={actionId === item.id} onClick={() => void resetCode(item)}>
                    重置验证码
                  </Button>
                  <Button danger loading={actionId === item.id} onClick={() => void deleteAccount(item)}>
                    删除
                  </Button>
                </div>
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
              <p>复制手机号和验证码到 App Store Connect Review Notes。</p>
            </div>
          </div>
          <div className="stack">
            <div className="inline-row"><strong>AppId:</strong><span>{revealed.item.appId}</span></div>
            <div className="inline-row"><strong>手机号:</strong><code data-testid="test-account-revealed-phone">{revealed.item.phone}</code></div>
            <div className="inline-row"><strong>验证码:</strong><code data-testid="test-account-revealed-code">{revealed.verifyCode}</code></div>
            <div className="inline-row"><strong>Revealed At:</strong><span>{formatTimestamp(revealed.revealedAt)}</span></div>
          </div>
        </section>
      ) : null}

      <Modal
        confirmLoading={saving}
        okButtonProps={{ disabled: !draft.appId || !draft.phone.trim() }}
        onCancel={() => setEditorOpen(false)}
        onOk={() => void saveDraft()}
        open={editorOpen}
        title={draft.id ? "编辑测试账号" : "新建测试账号"}
      >
        <div className="stack">
          <Field label="App">
            <Select
              onChange={(value) => setDraft((current) => ({ ...current, appId: value }))}
              options={appOptions}
              value={draft.appId}
            />
          </Field>
          <div className="form-grid" style={{ gridTemplateColumns: "120px minmax(0, 1fr)" }}>
            <Field label="区号">
              <Input
                onChange={(event) => setDraft((current) => ({ ...current, phoneNa: event.target.value }))}
                value={draft.phoneNa}
              />
            </Field>
            <Field label="手机号">
              <Input
                onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
                value={draft.phone}
              />
            </Field>
          </div>
          <Field label="标签">
            <Input
              onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
              placeholder="App Review"
              value={draft.label}
            />
          </Field>
          <ToggleField
            checked={draft.enabled}
            label="启用"
            onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
          />
        </div>
      </Modal>

      <SensitiveOperationModal
        description="为了查看测试账号静态验证码，需要先输入 6 位二级密码。"
        onAuthorized={async () => {
          if (!pendingRevealId) return;
          await revealCode(pendingRevealId, false);
        }}
        onClose={() => setPendingRevealId("")}
        open={Boolean(pendingRevealId)}
        operation={TEST_ACCOUNT_REVEAL_OPERATION}
        title="验证后查看验证码"
      />
    </>
  );
}
