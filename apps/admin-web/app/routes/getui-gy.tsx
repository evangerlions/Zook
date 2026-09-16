import { Button, Collapse, Input, Select } from "antd";
import { useEffect, useMemo, useState } from "react";

import { Field, ToggleField } from "../components/field";
import { GetuiGyCredentialFields } from "../components/getui-gy-credential-fields";
import { GetuiGyPlatformControl } from "../components/getui-gy-platform-control";
import { JsonPreview } from "../components/json-preview";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { ApiError, adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import {
  cloneGetuiGyConfig,
  createEmptyGetuiGyCredentials,
  createDefaultGetuiGyConfig,
  formatGetuiGyConfigJson,
  getGetuiGyDraftValidationError,
  isDefaultGetuiGyCredentials,
  normalizeGetuiGyDocument,
  serializeGetuiGyDraft,
  serializeGetuiGyDraftForPreview,
} from "../lib/getui-gy-config";
import type {
  AdminGetuiGyServiceDocument,
  GetuiGyPlatform,
  GetuiGyPlatformCredentials,
  GetuiGySensitiveCredentialField,
  GetuiGyServiceDraft,
} from "../lib/types";

const GETUI_GY_CREDENTIAL_READ_OPERATION = "getui_gy.credential.read";

export default function GetuiGyRoute() {
  const { apps, clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] = useState<AdminGetuiGyServiceDocument | null>(null);
  const [draft, setDraft] = useState<GetuiGyServiceDraft>(createDefaultGetuiGyConfig());
  const [originalDraft, setOriginalDraft] = useState<GetuiGyServiceDraft>(createDefaultGetuiGyConfig());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [pendingReveal, setPendingReveal] = useState<{
    zookAppId: string;
    field: GetuiGySensitiveCredentialField;
    platform?: GetuiGyPlatform;
  } | null>(null);
  const [revealingCredential, setRevealingCredential] = useState("");
  const validationError = useMemo(() => getGetuiGyDraftValidationError(draft), [draft]);
  const previewValue = useMemo(() => serializeGetuiGyDraftForPreview(draft), [draft]);
  const appOptions = useMemo(
    () => apps.map((item) => ({ label: `${item.appName} · ${item.appId}`, value: item.appId })),
    [apps],
  );
  const appCredentialRows = Object.entries(draft.apps);

  function applyDocument(payload: AdminGetuiGyServiceDocument | null) {
    const nextDraft = cloneGetuiGyConfig(payload?.config);
    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setDesc("");
  }

  async function loadConfig() {
    setLoading(true);
    try {
      applyDocument(normalizeGetuiGyDocument(await adminApi.getGetuiGyService()));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  function updateDraft<K extends keyof GetuiGyServiceDraft>(key: K, value: GetuiGyServiceDraft[K]) {
    setDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function updateMappingKey(currentAppId: string, nextAppId: string) {
    if (!nextAppId || currentAppId === nextAppId) {
      return;
    }

    setDraft((current) => {
      const apps = { ...current.apps };
      const currentValue = apps[currentAppId] ?? createEmptyGetuiGyCredentials(currentAppId);
      const value = isDefaultGetuiGyCredentials(currentAppId, currentValue)
        ? createEmptyGetuiGyCredentials(nextAppId)
        : currentValue;
      delete apps[currentAppId];
      apps[nextAppId] = value;
      return {
        ...current,
        apps,
      };
    });
  }

  function updateAppCredential(
    appId: string,
    key: "appId" | "appKey" | "appSecret" | "masterSecret",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [appId]: {
          ...(current.apps[appId] ?? createEmptyGetuiGyCredentials(appId)),
          [key]: value,
        },
      },
    }));
  }

  function updatePlatformCredential(
    appId: string,
    platform: GetuiGyPlatform,
    key: "appId" | "appKey" | "appSecret" | "masterSecret",
    value: string,
  ) {
    setDraft((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [appId]: {
          ...(current.apps[appId] ?? createEmptyGetuiGyCredentials(appId)),
          platforms: {
            ...(current.apps[appId]?.platforms ?? {}),
            [platform]: {
              ...(current.apps[appId]?.platforms?.[platform] ?? {
                appId: "",
                appKey: "",
                appSecret: "",
                masterSecret: "",
              }),
              [key]: value,
            } as GetuiGyPlatformCredentials,
          },
        },
      },
    }));
  }

  function addPlatform(appId: string, platform: GetuiGyPlatform) {
    setDraft((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [appId]: {
          ...(current.apps[appId] ?? createEmptyGetuiGyCredentials(appId)),
          platforms: {
            ...(current.apps[appId]?.platforms ?? {}),
            [platform]: {
              appId: "",
              appKey: "",
              appSecret: "",
              masterSecret: "",
            },
          },
        },
      },
    }));
  }

  function removePlatform(appId: string, platform: GetuiGyPlatform) {
    setDraft((current) => {
      const currentCredentials = current.apps[appId];
      if (!currentCredentials?.platforms) {
        return current;
      }
      const platforms = { ...currentCredentials.platforms };
      delete platforms[platform];
      return {
        ...current,
        apps: {
          ...current.apps,
          [appId]: {
            ...currentCredentials,
            platforms: Object.keys(platforms).length ? platforms : undefined,
          },
        },
      };
    });
  }

  function addMappingRow() {
    const usedAppIds = new Set(Object.keys(draft.apps));
    const nextAppId = apps.find((item) => !usedAppIds.has(item.appId))?.appId;
    if (!nextAppId) {
      setNotice(makeNotice("info", "没有可添加的 Zook AppID。"));
      return;
    }

    setDraft((current) => ({
      ...current,
      apps: {
        ...current.apps,
        [nextAppId]: createEmptyGetuiGyCredentials(nextAppId),
      },
    }));
  }

  function removeMappingRow(appId: string) {
    setDraft((current) => {
      const apps = { ...current.apps };
      delete apps[appId];
      return {
        ...current,
        apps,
      };
    });
  }

  async function revealCredentialValue(
    zookAppId: string,
    field: GetuiGySensitiveCredentialField,
    platform?: GetuiGyPlatform,
    allowPrompt = true,
  ) {
    const revealKey = `${zookAppId}:${platform ?? "base"}:${field}`;
    setRevealingCredential(revealKey);
    clearNotice();
    try {
      const payload = await adminApi.revealGetuiGyCredentialValue(
        zookAppId,
        field,
        platform,
      );
      if (platform) {
        updatePlatformCredential(zookAppId, platform, field, payload.value);
      } else {
        updateAppCredential(zookAppId, field, payload.value);
      }
      setPendingReveal(null);
      setNotice(makeNotice("success", `${zookAppId} 的 ${field} 已显示明文，1 小时内无需再次验证。`));
    } catch (error) {
      if (
        allowPrompt &&
        error instanceof ApiError &&
        error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED"
      ) {
        setPendingReveal({ zookAppId, field, platform });
        return;
      }

      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRevealingCredential("");
    }
  }

  function openSaveModal() {
    clearNotice();
    if (validationError) {
      setNotice(makeNotice("error", validationError));
      return;
    }
    setSaveModalOpen(true);
  }

  async function handleConfirmSave() {
    setSaving(true);
    clearNotice();
    try {
      const payload = await adminApi.updateGetuiGyService({
        ...serializeGetuiGyDraft(draft),
        desc: desc.trim() || undefined,
      });
      applyDocument(normalizeGetuiGyDocument(payload));
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "GeYan 一键登录配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = await adminApi.getGetuiGyServiceRevision(revision);
      applyDocument(normalizeGetuiGyDocument(payload));
      setNotice(makeNotice("info", `正在查看 R${revision}，保存前不会影响线上配置。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleRequestRestoreRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = normalizeGetuiGyDocument(await adminApi.getGetuiGyServiceRevision(revision));
      setRestoreRevision(revision);
      setRestoreDesc(`恢复到 R${revision}`);
      setRestoreOldValue(formatGetuiGyConfigJson(originalDraft));
      setRestoreNewValue(formatGetuiGyConfigJson(payload?.config));
      setRestoreModalOpen(true);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleConfirmRestore() {
    if (!restoreRevision) {
      return;
    }
    setRestoringRevision(restoreRevision);
    clearNotice();
    try {
      const payload = await adminApi.restoreGetuiGyService(restoreRevision, restoreDesc.trim() || undefined);
      applyDocument(normalizeGetuiGyDocument(payload));
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setNotice(makeNotice("success", `已恢复到 R${restoreRevision}。`));
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
          <h1>GeYan 一键登录</h1>
          <p>统一维护 `common.getui_gy_service`，用于运营商一键登录取号与后端 token 换号。</p>
        </div>
        <div className="top-actions">
          <Button disabled={loading} onClick={() => void loadConfig()}>刷新</Button>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
        </div>
      </header>

      <section className="surface-card collapse-card">
        <Collapse
          className="config-collapse"
          defaultActiveKey={[]}
          items={[
            {
              key: "structure-preview",
              label: "结构预览",
              children: <JsonPreview value={previewValue} />,
            },
          ]}
        />
      </section>

      <div className="content-with-history">
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>服务配置</h2>
              <p>每个 Zook AppID 绑定独立的 GeYan 凭据；需要时可通过“+”为该应用增加 OHOS 凭据。</p>
            </div>
            <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          </div>

          {loading ? <p className="meta-text">正在加载 GeYan 配置...</p> : null}

          <div className="stack">
            <ToggleField
              checked={draft.enabled}
              hint="关闭时，客户端一键登录 readiness 会快速返回 503。"
              label="启用 GeYan 一键登录"
              onChange={(value) => updateDraft("enabled", value)}
            />

            <div className="form-grid">
              <Field label="取号 Endpoint">
                <Input
                  onChange={(event) => updateDraft("endpoint", event.target.value)}
                  size="large"
                  value={draft.endpoint}
                />
              </Field>
            </div>

            <section className="inline-panel">
              <div className="card-header">
                <div>
                  <h3>AppID 映射</h3>
                  <p>每行是一条 key-value 映射：key 是 Zook AppID，value 是该 App 的完整 GeYan 凭据。</p>
                </div>
                <Button disabled={appCredentialRows.length >= apps.length} onClick={addMappingRow}>
                  添加映射
                </Button>
              </div>

              {appCredentialRows.length ? (
                <div className="mapping-list">
                  {appCredentialRows.map(([zookAppId, credentials]) => {
                    const ohosCredentials = credentials.platforms?.ohos;
                    return (
                    <div className="mapping-row" key={zookAppId}>
                      <div className="mapping-key-column">
                        <span className="field-label">Zook AppID</span>
                        <Select
                          onChange={(nextAppId) => updateMappingKey(zookAppId, nextAppId)}
                          options={appOptions.map((option) => ({
                            ...option,
                            disabled: option.value !== zookAppId && Object.hasOwn(draft.apps, option.value),
                          }))}
                          placeholder="Zook AppID"
                          size="large"
                          value={zookAppId}
                        />
                      </div>
                      <GetuiGyCredentialFields
                        appId={zookAppId}
                        credentials={credentials}
                        onChange={(field, value) => updateAppCredential(zookAppId, field, value)}
                        onReveal={(field) => void revealCredentialValue(zookAppId, field)}
                        revealingCredential={revealingCredential}
                      />
                      <GetuiGyPlatformControl
                        appId={zookAppId}
                        credentials={ohosCredentials}
                        onAdd={() => addPlatform(zookAppId, "ohos")}
                        onChange={(field, value) => updatePlatformCredential(zookAppId, "ohos", field, value)}
                        onRemove={() => removePlatform(zookAppId, "ohos")}
                        onReveal={(field) => void revealCredentialValue(zookAppId, field, "ohos")}
                        revealingCredential={revealingCredential}
                      />
                      <Button danger onClick={() => removeMappingRow(zookAppId)}>
                        删除
                      </Button>
                    </div>
                    );
                  })}
                </div>
              ) : (
                <p className="meta-text">还没有配置映射。启用前至少添加一条映射。</p>
              )}
            </section>

            <div className="form-grid">
              <Field label="超时时间 ms">
                <Input
                  inputMode="numeric"
                  onChange={(event) => updateDraft("timeoutMs", event.target.value)}
                  size="large"
                  value={draft.timeoutMs}
                />
              </Field>

              <Field hint="会写入版本历史，方便回滚时识别。" label="更新说明">
                <Input
                  onChange={(event) => setDesc(event.target.value)}
                  placeholder="例如：启用 flutter_demo GeYan 一键登录"
                  size="large"
                  value={desc}
                />
              </Field>
            </div>

            {validationError ? <p className="form-error">{validationError}</p> : null}

            <div className="button-row">
              <Button
                disabled={saving || loading || Boolean(validationError)}
                onClick={openSaveModal}
                size="large"
                type="primary"
              >
                保存 GeYan 配置
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
        descPlaceholder="例如：启用 flutter_demo GeYan 一键登录"
        loading={saving}
        newValue={JSON.stringify(serializeGetuiGyDraftForPreview(draft), null, 2)}
        oldValue={formatGetuiGyConfigJson(originalDraft)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存 GeYan 一键登录配置"
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
        onConfirm={() => void handleConfirmRestore()}
        onDescChange={setRestoreDesc}
        open={restoreModalOpen}
        okText="确认恢复"
        title="恢复 GeYan 配置版本"
      />

      <SensitiveOperationModal
        description="为了显示 GeYan 凭据明文，需要先输入 6 位二级密码。验证通过后，当前登录会话会自动获得 1 小时敏感操作权限。"
        onAuthorized={async () => {
          if (!pendingReveal) {
            return;
          }

          await revealCredentialValue(
            pendingReveal.zookAppId,
            pendingReveal.field,
            pendingReveal.platform,
            false,
          );
        }}
        onClose={() => setPendingReveal(null)}
        open={Boolean(pendingReveal)}
        operation={GETUI_GY_CREDENTIAL_READ_OPERATION}
        title="验证后显示 GeYan 凭据"
      />
    </section>
  );
}
