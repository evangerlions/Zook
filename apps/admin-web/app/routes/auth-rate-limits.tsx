import { Alert, Button, Collapse, Input, InputNumber, Segmented } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Field } from "../components/field";
import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import {
  cloneAuthRateLimitConfig,
  createDefaultAuthRateLimitConfig,
  formatAuthRateLimitConfigJson,
  getAuthRateLimitValidationError,
  normalizeAuthRateLimitDocument,
  parseAuthRateLimitConfigText,
  serializeAuthRateLimitConfig,
} from "../lib/auth-rate-limit-config";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type { AdminAuthRateLimitDocument, AuthRateLimitConfig } from "../lib/types";

const CONFIG_MODE_OPTIONS: Array<{ label: string; value: "form" | "raw" }> = [
  { label: "表单", value: "form" },
  { label: "RAW JSON", value: "raw" },
];

const LIMIT_FIELD_COPY: Array<{
  key: keyof AuthRateLimitConfig;
  label: string;
  hint: string;
}> = [
  {
    key: "resendCooldownSeconds",
    label: "发码冷却（秒）",
    hint: "同一 app + 账号 + IP 在这段冷却时间内不能连续重复请求验证码。",
  },
  {
    key: "verificationCodeTtlSeconds",
    label: "验证码有效期（秒）",
    hint: "超过这个有效期后，验证码会直接判无效，需要重新发码。",
  },
  {
    key: "sendCodeWindowSeconds",
    label: "发码窗口（秒）",
    hint: "“发码窗口次数上限”统计的滑动窗口长度。",
  },
  {
    key: "sendCodeWindowLimit",
    label: "发码窗口次数上限",
    hint: "同一 app + 账号 + IP 在发码窗口内最多允许请求多少次验证码。",
  },
  {
    key: "verifyWindowSeconds",
    label: "验证提交窗口（秒）",
    hint: "登录 / 注册 / 重置密码提交验证码时的滑动窗口长度。",
  },
  {
    key: "verifyWindowLimit",
    label: "验证提交窗口次数上限",
    hint: "同一 app + 账号 + IP 在验证窗口内最多允许提交多少次验证码。",
  },
  {
    key: "maxFailedCodeAttempts",
    label: "验证码最多输错次数",
    hint: "同一个验证码在有效期内最多允许输错多少次，达到上限后该验证码立即失效。",
  },
  {
    key: "accountDailyLimit",
    label: "账号自然日配额",
    hint: "同一个账号标识（邮箱或手机号）在自然日内最多允许触发多少次发码。",
  },
  {
    key: "ipHourlyLimit",
    label: "IP 自然小时配额",
    hint: "同一个 IP 在自然小时内最多允许触发多少次发码。",
  },
];

function updateConfigField(
  current: AuthRateLimitConfig,
  key: keyof AuthRateLimitConfig,
  value: number,
): AuthRateLimitConfig {
  return {
    ...current,
    [key]: value,
  };
}

export default function AuthRateLimitsRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [configMode, setConfigMode] = useState<"form" | "raw">("form");
  const [document, setDocument] = useState<AdminAuthRateLimitDocument | null>(null);
  const [draft, setDraft] = useState<AuthRateLimitConfig>(createDefaultAuthRateLimitConfig());
  const [originalDraft, setOriginalDraft] = useState<AuthRateLimitConfig>(createDefaultAuthRateLimitConfig());
  const [rawValue, setRawValue] = useState(() => formatAuthRateLimitConfigJson(createDefaultAuthRateLimitConfig()));
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const draftValidationError = useMemo(() => getAuthRateLimitValidationError(draft), [draft]);
  const rawValidation = useMemo(() => {
    try {
      return {
        ...parseAuthRateLimitConfigText(rawValue),
        error: "",
      };
    } catch (error) {
      return {
        config: null,
        normalizedText: "",
        error: formatApiError(error),
      };
    }
  }, [rawValue]);
  const draftSnapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const rawDraftSnapshot = useMemo(
    () => (rawValidation.config ? JSON.stringify(rawValidation.config) : ""),
    [rawValidation.config],
  );
  const activeConfigError = configMode === "raw" ? rawValidation.error : draftValidationError;

  function applyConfigDocument(payload: AdminAuthRateLimitDocument | null) {
    const nextDraft = cloneAuthRateLimitConfig(payload?.config);
    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setRawValue(formatAuthRateLimitConfigJson(payload?.config ?? nextDraft));
    setDesc("");
  }

  async function loadLatest() {
    setLoading(true);
    try {
      applyConfigDocument(normalizeAuthRateLimitDocument(await adminApi.getAuthRateLimits()));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, []);

  useEffect(() => {
    if (configMode !== "raw" || rawValidation.error || !rawValidation.config || rawDraftSnapshot === draftSnapshot) {
      return;
    }

    setDraft(rawValidation.config);
  }, [configMode, draftSnapshot, rawDraftSnapshot, rawValidation.config, rawValidation.error]);

  useEffect(() => {
    if (configMode === "raw") {
      return;
    }

    setRawValue(formatAuthRateLimitConfigJson(draft));
  }, [configMode, draft]);

  function openSaveModal() {
    if (activeConfigError) {
      return;
    }
    setSaveModalOpen(true);
  }

  async function handleConfirmSave() {
    setSaving(true);
    clearNotice();
    try {
      const nextConfig = configMode === "raw" ? parseAuthRateLimitConfigText(rawValue).config : serializeAuthRateLimitConfig(draft);
      const payload = normalizeAuthRateLimitDocument(
        await adminApi.updateAuthRateLimits({
          ...nextConfig,
          desc: desc.trim() || undefined,
        }),
      );
      applyConfigDocument(payload);
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "认证风控配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      applyConfigDocument(normalizeAuthRateLimitDocument(await adminApi.getAuthRateLimitsRevision(revision)));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRestoreRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const [latestPayload, revisionPayload] = await Promise.all([
        adminApi.getAuthRateLimits(),
        adminApi.getAuthRateLimitsRevision(revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(JSON.stringify(latestPayload.config, null, 2));
      setRestoreNewValue(JSON.stringify(revisionPayload.config, null, 2));
      setRestoreDesc(`回滚到版本 R${revision}`);
      setRestoreModalOpen(true);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleConfirmRestoreRevision() {
    if (!restoreRevision) {
      return;
    }

    setRestoringRevision(restoreRevision);
    clearNotice();
    try {
      const payload = normalizeAuthRateLimitDocument(
        await adminApi.restoreAuthRateLimits(restoreRevision, restoreDesc.trim() || undefined),
      );
      applyConfigDocument(payload);
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>认证风控</h1>
          <p>统一维护邮箱 / 短信登录、注册、密码找回共用的验证码限流策略和错误阈值。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
          <span className="meta-chip">自然日 / 自然小时按 Asia/Shanghai 计算</span>
        </div>
      </header>

      <section className="surface-card collapse-card">
        <Collapse
          className="config-collapse"
          defaultActiveKey={["structure-preview", "rule-explainer"]}
          items={[
            {
              key: "structure-preview",
              label: "结构预览",
              children: activeConfigError ? (
                <div className="empty-state">当前配置还没有通过校验，暂时无法生成结构预览。</div>
              ) : (
                <JsonPreview value={configMode === "raw" ? rawValidation.config : serializeAuthRateLimitConfig(draft)} />
              ),
            },
            {
              key: "rule-explainer",
              label: "规则说明",
              children: (
                <div className="stack">
                  <Alert
                    message="这些阈值同时作用于邮箱验证码和短信验证码主链路。发码相关接口看“发码窗口/账号日配额/IP小时配额”，提交验证码的登录/注册/重置流程看“验证提交窗口/最多输错次数”。"
                    showIcon
                    type="info"
                  />
                  <ul className="plain-list">
                    <li>`sendCodeWindow*`：限制发验证码接口，维度是 `appId + account + IP`。</li>
                    <li>`verifyWindow*`：限制提交验证码完成登录/注册/重置的接口，维度也是 `appId + account + IP`。</li>
                    <li>`accountDailyLimit`：自然日维度的账号发码配额；这里只暴露语义阈值，不暴露底层 48h 清理 TTL。</li>
                    <li>`ipHourlyLimit`：自然小时维度的 IP 发码配额；这里只暴露语义阈值，不暴露底层 2h 清理 TTL。</li>
                    <li>`maxFailedCodeAttempts`：单个已发出的验证码最多允许输错多少次；达到上限后，该验证码立即失效。</li>
                  </ul>
                </div>
              ),
            },
          ]}
        />
      </section>

      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>基础配置</h2>
              <p>表单模式适合日常调整，RAW JSON 模式适合一次性整体修改和回看结构。</p>
            </div>
            <div className="top-actions">
              {!document?.isLatest ? (
                <Button onClick={() => void loadLatest()} size="large">
                  回到最新
                </Button>
              ) : null}
              <Button onClick={() => void loadLatest()} size="large">
                刷新
              </Button>
            </div>
          </div>

          {loading ? <p className="meta-text">正在加载认证风控配置...</p> : null}

          <div className="stack">
            <div className="config-mode-toolbar">
              <Segmented
                className="range-segmented"
                onChange={(value) => setConfigMode(value as "form" | "raw")}
                options={CONFIG_MODE_OPTIONS}
                value={configMode}
              />
              <span className="meta-chip">{activeConfigError ? "校验待修正" : "校验通过"}</span>
            </div>

            {configMode === "form" ? (
              <>
                <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                  {LIMIT_FIELD_COPY.map((item) => (
                    <Field hint={item.hint} key={item.key} label={item.label}>
                      <InputNumber
                        min={1}
                        onChange={(value) => {
                          const nextValue = Number(value ?? 1);
                          setDraft((current) => updateConfigField(current, item.key, nextValue));
                        }}
                        precision={0}
                        size="large"
                        style={{ width: "100%" }}
                        value={draft[item.key]}
                      />
                    </Field>
                  ))}
                </div>
                {draftValidationError ? <p className="form-error">{draftValidationError}</p> : null}
              </>
            ) : (
              <label className="field">
                <span className="field-label">RAW JSON</span>
                <JsonEditor
                  onChange={setRawValue}
                  readOnly={loading || saving}
                  value={rawValue}
                />
                {rawValidation.error ? (
                  <small className="form-error">{rawValidation.error}</small>
                ) : (
                  <small className="field-hint">保存前会重新校验字段是否为正整数，并检查验证提交窗口上限是否覆盖错码阈值。</small>
                )}
              </label>
            )}

            <Field hint="会进入版本历史，后续回滚时也会保留。" label="Revision Desc">
              <Input
                onChange={(event) => setDesc(event.target.value)}
                placeholder="例如：将手机号自然日配额从 5 提到 10"
                size="large"
                value={desc}
              />
            </Field>

            <div className="button-row">
              <Button
                disabled={saving || loading || Boolean(activeConfigError)}
                onClick={openSaveModal}
                size="large"
                type="primary"
              >
                保存认证风控
              </Button>
            </div>
          </div>
        </section>

        <RevisionHistoryDock
          expanded={historyExpanded}
          onToggle={() => setHistoryExpanded((current) => !current)}
        >
          <RevisionList
            activeRevision={document?.revision}
            compact
            latestRevision={document?.revisions?.[0]?.revision}
            loadingRevision={restoringRevision}
            onRestore={(revision) => void handleRequestRestoreRevision(revision)}
            onSelect={(revision) => void handleViewRevision(revision)}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：调高手机号自然日配额，保留其他阈值不变"
        loading={saving}
        newValue={configMode === "raw" ? rawValidation.normalizedText : JSON.stringify(serializeAuthRateLimitConfig(draft), null, 2)}
        oldValue={JSON.stringify(serializeAuthRateLimitConfig(originalDraft), null, 2)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存认证风控配置"
      />
      <SaveConfirmModal
        autoGenerateDesc={false}
        desc={restoreDesc}
        descPlaceholder="例如：回滚到上一个稳定版本"
        loading={Boolean(restoreRevision) && restoringRevision === restoreRevision}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreRevision(null);
          setRestoreDesc("");
        }}
        onConfirm={() => void handleConfirmRestoreRevision()}
        onDescChange={setRestoreDesc}
        okText="确认回滚"
        open={restoreModalOpen}
        title={restoreRevision ? `确认回滚到版本 R${restoreRevision}` : "确认回滚"}
      />
    </section>
  );
}
