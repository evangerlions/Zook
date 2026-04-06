import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, Popconfirm, Select, Tooltip } from "antd";
import { useEffect, useState } from "react";

import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { ApiError, adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { writeClipboard } from "../lib/clipboard";
import { formatApiError, makeNotice } from "../lib/format";
import { SUPPORTED_LOCALE_OPTIONS } from "../lib/locale-options";
import type { AdminAppSummary } from "../lib/types";

const APP_LOG_SECRET_READ_OPERATION = "app.log_secret.read";
const REQUIRED_LOCALES = new Set(["zh-CN", "en-US"]);

interface LocaleNameDraft {
  id: string;
  locale: string;
  value: string;
}

function createLocaleNameDraft(locale = "", value = ""): LocaleNameDraft {
  return {
    id: `locale_${Date.now()}_${Math.random().toString(16).slice(2)}`,
    locale,
    value,
  };
}

function createExtraLocaleDrafts(app: AdminAppSummary): LocaleNameDraft[] {
  return Object.entries(app.appNameI18n ?? {})
    .filter(([locale]) => !REQUIRED_LOCALES.has(locale))
    .sort(([left], [right]) => left.localeCompare(right, "en-US"))
    .map(([locale, value]) => createLocaleNameDraft(locale, value));
}

function normalizeLocaleInput(value: string): string {
  return value.trim().replaceAll("_", "-");
}

export default function AppsRoute() {
  const {
    apps,
    selectedAppId,
    setSelectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
    completeWorkspaceTransition,
  } = useAdminSession();

  const [appId, setAppId] = useState("");
  const [appNameZhCn, setAppNameZhCn] = useState("");
  const [appNameEnUs, setAppNameEnUs] = useState("");
  const [creatingApp, setCreatingApp] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [editingApp, setEditingApp] = useState<AdminAppSummary | null>(null);
  const [editingNameZhCn, setEditingNameZhCn] = useState("");
  const [editingNameEnUs, setEditingNameEnUs] = useState("");
  const [editingExtraNames, setEditingExtraNames] = useState<LocaleNameDraft[]>([]);
  const [savingAppNames, setSavingAppNames] = useState(false);
  const [deletingAppId, setDeletingAppId] = useState("");
  const [copyingAppId, setCopyingAppId] = useState("");
  const [pendingSensitiveAppId, setPendingSensitiveAppId] = useState("");

  function closeCreateModal() {
    setCreateModalOpen(false);
    setAppId("");
    setAppNameZhCn("");
    setAppNameEnUs("");
  }

  function openEditNamesModal(app: AdminAppSummary) {
    setEditingApp(app);
    setEditingNameZhCn(app.appNameI18n?.["zh-CN"] ?? "");
    setEditingNameEnUs(app.appNameI18n?.["en-US"] ?? "");
    setEditingExtraNames(createExtraLocaleDrafts(app));
  }

  function closeEditNamesModal() {
    setEditingApp(null);
    setEditingNameZhCn("");
    setEditingNameEnUs("");
    setEditingExtraNames([]);
  }

  async function handleCreateApp() {
    if (!appId.trim()) {
      setNotice(makeNotice("error", "请输入 App ID。"));
      return;
    }

    if (!appNameZhCn.trim()) {
      setNotice(makeNotice("error", "请输入 App 中文名。"));
      return;
    }

    if (!appNameEnUs.trim()) {
      setNotice(makeNotice("error", "请输入 App 英文名。"));
      return;
    }

    setCreatingApp(true);
    clearNotice();
    try {
      const payload = await adminApi.createApp(appId.trim(), appNameZhCn.trim(), appNameEnUs.trim());
      await reloadBootstrap();
      setSelectedAppId(payload.appId);
      closeCreateModal();
      setNotice(makeNotice("success", "App 已添加，并已自动生成密钥。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCreatingApp(false);
    }
  }

  function updateExtraLocaleDraft(id: string, patch: Partial<Pick<LocaleNameDraft, "locale" | "value">>) {
    setEditingExtraNames((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function removeExtraLocaleDraft(id: string) {
    setEditingExtraNames((current) => current.filter((item) => item.id !== id));
  }

  function getExtraLocaleOptions(currentLocale: string) {
    const currentValue = normalizeLocaleInput(currentLocale);
    const usedLocales = new Set(
      editingExtraNames
        .map((item) => normalizeLocaleInput(item.locale))
        .filter(Boolean),
    );

    return SUPPORTED_LOCALE_OPTIONS.filter((item) => (
      !REQUIRED_LOCALES.has(item.value)
      && (item.value === currentValue || !usedLocales.has(item.value))
    ));
  }

  async function handleSaveAppNames() {
    if (!editingApp) {
      return;
    }

    if (!editingNameZhCn.trim()) {
      setNotice(makeNotice("error", "请输入中文名（zh-CN）。"));
      return;
    }

    if (!editingNameEnUs.trim()) {
      setNotice(makeNotice("error", "请输入英文名（en-US）。"));
      return;
    }

    const nextNames: Record<string, string> = {
      "zh-CN": editingNameZhCn.trim(),
      "en-US": editingNameEnUs.trim(),
    };
    const seenLocales = new Set<string>(["zh-cn", "en-us"]);

    for (const item of editingExtraNames) {
      const locale = normalizeLocaleInput(item.locale);
      const value = item.value.trim();
      if (!locale) {
        setNotice(makeNotice("error", "请先从下拉列表里选择额外语言。"));
        return;
      }

      if (!value) {
        setNotice(makeNotice("error", `请填写 ${locale} 对应的 App 名称。`));
        return;
      }

      const localeKey = locale.toLowerCase();
      if (seenLocales.has(localeKey)) {
        setNotice(makeNotice("error", `${locale} 已经存在，请勿重复添加。`));
        return;
      }

      seenLocales.add(localeKey);
      nextNames[locale] = value;
    }

    setSavingAppNames(true);
    clearNotice();
    try {
      const payload = await adminApi.updateAppNames(editingApp.appId, nextNames);
      await reloadBootstrap();
      closeEditNamesModal();
      setNotice(makeNotice("success", `已更新 ${payload.appName} 的多语言名称。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSavingAppNames(false);
    }
  }

  async function copyAppSecret(nextAppId: string, allowPrompt = true) {
    setCopyingAppId(nextAppId);
    clearNotice();
    try {
      const payload = await adminApi.revealAppLogSecret(nextAppId);
      await writeClipboard(payload.secret);
      setNotice(makeNotice("success", `已复制 ${payload.app.appName} 的完整密钥，1 小时内无需再次验证。`));
      setPendingSensitiveAppId("");
    } catch (error) {
      if (
        allowPrompt
        && error instanceof ApiError
        && error.code === "ADMIN_SENSITIVE_OPERATION_REQUIRED"
      ) {
        setPendingSensitiveAppId(nextAppId);
        return;
      }

      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setCopyingAppId("");
    }
  }

  async function handleDeleteApp(nextAppId: string) {
    const app = apps.find((item) => item.appId === nextAppId);
    if (!app) {
      return;
    }

    setDeletingAppId(nextAppId);
    clearNotice();
    try {
      await adminApi.deleteApp(nextAppId);
      await reloadBootstrap();
      if (selectedAppId === nextAppId) {
        setSelectedAppId("");
      }
      setNotice(makeNotice("success", "App 已删除。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setDeletingAppId("");
    }
  }

  useEffect(() => {
    completeWorkspaceTransition();
  }, [completeWorkspaceTransition]);

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>应用管理</h1>
          <p>管理所有 App 项目空间。创建时会自动生成密钥；复制完整密钥前需要完成一次敏感操作验证。</p>
        </div>
        <div className="top-actions">
          <Button
            icon={<PlusOutlined />}
            onClick={() => setCreateModalOpen(true)}
            size="large"
            type="primary"
          >
            新增 App
          </Button>
        </div>
      </header>

      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>应用列表</h2>
            <p>
              `Key ID` 是密钥编号，`密钥` 是实际 secret；多语言 App 名称可通过操作区的小图标在弹窗里维护。
            </p>
          </div>
        </div>

        {apps.length ? (
          <div className="table-wrap">
            <table className="app-admin-table">
              <thead>
                <tr>
                  <th>应用</th>
                  <th>App ID</th>
                  <th>Key ID</th>
                  <th>密钥</th>
                  <th>状态</th>
                  <th>更新时间</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {apps.map((item) => {
                  const isCurrent = selectedAppId === item.appId;
                  const englishName = item.appNameI18n?.["en-US"] ?? "";
                  const localeCount = Object.keys(item.appNameI18n ?? {}).length;
                  return (
                    <tr key={item.appId}>
                      <td>
                        <div className="table-primary-cell">
                          <strong>{item.appName}</strong>
                          {englishName && englishName !== item.appName ? (
                            <span className="meta-text">{englishName}</span>
                          ) : null}
                          <span className="meta-chip">{localeCount} 个名称</span>
                          {isCurrent ? <span className="meta-chip">当前项目</span> : null}
                        </div>
                      </td>
                      <td>
                        <span className="mono table-code">{item.appId}</span>
                      </td>
                      <td>
                        <span className="mono table-code">{item.logSecret.keyId}</span>
                      </td>
                      <td>
                        <span className="mono table-code">{item.logSecret.secretMasked}</span>
                      </td>
                      <td>
                        <div className="inline-row">
                          <span className="status-chip">{item.status}</span>
                        </div>
                      </td>
                      <td>{new Date(item.logSecret.updatedAt).toLocaleString("zh-CN")}</td>
                      <td>
                        <div className="table-actions">
                          <Tooltip title="编辑多语言名称">
                            <span>
                              <Button
                                aria-label={`编辑 ${item.appName} 的多语言名称`}
                                className="action-icon-button"
                                icon={<EditOutlined />}
                                onClick={() => openEditNamesModal(item)}
                                shape="circle"
                                type="default"
                              />
                            </span>
                          </Tooltip>

                          <Tooltip title="复制密钥值（不含 Key ID）">
                            <span>
                              <Button
                                aria-label={`复制 ${item.appName} 的密钥`}
                                className="action-icon-button"
                                icon={<CopyOutlined />}
                                loading={copyingAppId === item.appId}
                                onClick={() => void copyAppSecret(item.appId)}
                                shape="circle"
                                type="default"
                              />
                            </span>
                          </Tooltip>

                          <Popconfirm
                            cancelText="取消"
                            disabled={!item.canDelete || deletingAppId === item.appId}
                            okText="删除"
                            onConfirm={() => void handleDeleteApp(item.appId)}
                            title={`确认删除 ${item.appName} (${item.appId})？`}
                          >
                            <Tooltip title={item.canDelete ? "删除 App" : "当前配置未清空，暂不可删除"}>
                              <span>
                                <Button
                                  aria-label={`删除 ${item.appName}`}
                                  className="action-icon-button"
                                  danger
                                  disabled={!item.canDelete || deletingAppId === item.appId}
                                  icon={<DeleteOutlined />}
                                  loading={deletingAppId === item.appId}
                                  shape="circle"
                                  type="default"
                                />
                              </span>
                            </Tooltip>
                          </Popconfirm>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">当前还没有业务 App，可以先从上方创建一个。</div>
        )}
      </section>

      <Modal
        cancelText="取消"
        okButtonProps={{ loading: creatingApp }}
        okText="创建 App"
        onCancel={closeCreateModal}
        onOk={() => void handleCreateApp()}
        open={createModalOpen}
        title="新增 App"
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">App ID</span>
            <Input
              disabled={creatingApp}
              onChange={(event) => setAppId(event.target.value)}
              placeholder="例如 app_a"
              size="large"
              value={appId}
            />
            <small className="field-hint">建议使用稳定、可读的技术代号，创建后会写入默认 config。</small>
          </label>

          <label className="field">
            <span className="field-label">App 中文名</span>
            <Input
              disabled={creatingApp}
              onChange={(event) => setAppNameZhCn(event.target.value)}
              placeholder="例如 小说工坊"
              size="large"
              value={appNameZhCn}
            />
            <small className="field-hint">中国大陆相关邮件会优先使用这个名字。</small>
          </label>

          <label className="field">
            <span className="field-label">App 英文名</span>
            <Input
              disabled={creatingApp}
              onChange={(event) => setAppNameEnUs(event.target.value)}
              placeholder="For example Novel Forge"
              size="large"
              value={appNameEnUs}
            />
            <small className="field-hint">其他地区会优先使用对应 locale 的名字，缺失时回退到英文名。</small>
          </label>
        </div>
      </Modal>

      <Modal
        cancelText="取消"
        destroyOnClose
        okButtonProps={{ loading: savingAppNames }}
        okText="保存名称"
        onCancel={closeEditNamesModal}
        onOk={() => void handleSaveAppNames()}
        open={Boolean(editingApp)}
        title={editingApp ? `编辑 ${editingApp.appId} 的多语言名称` : "编辑多语言名称"}
      >
        <div className="stack">
          <label className="field">
            <span className="field-label">中文名（zh-CN）</span>
            <Input
              disabled={savingAppNames}
              onChange={(event) => setEditingNameZhCn(event.target.value)}
              placeholder="例如 小说工坊"
              size="large"
              value={editingNameZhCn}
            />
            <small className="field-hint">中国大陆相关邮件会优先使用中文名。</small>
          </label>

          <label className="field">
            <span className="field-label">英文名（en-US）</span>
            <Input
              disabled={savingAppNames}
              onChange={(event) => setEditingNameEnUs(event.target.value)}
              placeholder="For example Novel Forge"
              size="large"
              value={editingNameEnUs}
            />
            <small className="field-hint">其他地区没有命中本地名称时，会回退到英文名。</small>
          </label>

          <section className="app-name-modal-section">
            <div className="card-header compact-card-header">
              <div>
                <h3>其他语言</h3>
                <p>低频语言名称放在这里维护，例如 `ja-JP`、`fr-FR`。</p>
              </div>
              <Button
                icon={<PlusOutlined />}
                onClick={() => setEditingExtraNames((current) => [...current, createLocaleNameDraft()])}
                type="dashed"
              >
                添加语言
              </Button>
            </div>

            {editingExtraNames.length ? (
              <div className="app-name-locale-list">
                {editingExtraNames.map((item) => (
                  <div className="app-name-locale-row" key={item.id}>
                    <label className="field">
                      <span className="field-label">Locale</span>
                      <Select
                        allowClear
                        disabled={savingAppNames}
                        onChange={(value) => updateExtraLocaleDraft(item.id, { locale: value ?? "" })}
                        options={getExtraLocaleOptions(item.locale)}
                        placeholder="选择语言"
                        showSearch
                        size="large"
                        optionFilterProp="label"
                        value={item.locale || undefined}
                      />
                    </label>
                    <label className="field">
                      <span className="field-label">名称</span>
                      <Input
                        disabled={savingAppNames}
                        onChange={(event) => updateExtraLocaleDraft(item.id, { value: event.target.value })}
                        placeholder="例如 ノベル工房"
                        value={item.value}
                      />
                    </label>
                    <Tooltip title="移除这条语言名称">
                      <span className="app-name-locale-remove">
                        <Button
                          aria-label={`移除 ${item.locale || "这条"} 语言名称`}
                          className="action-icon-button"
                          danger
                          disabled={savingAppNames}
                          icon={<DeleteOutlined />}
                          onClick={() => removeExtraLocaleDraft(item.id)}
                          shape="circle"
                          type="default"
                        />
                      </span>
                    </Tooltip>
                  </div>
                ))}
              </div>
            ) : (
              <div className="empty-state compact-empty-state">当前只有默认的中文名和英文名。</div>
            )}
          </section>
        </div>
      </Modal>

      <SensitiveOperationModal
        description="为了复制完整密钥，需要先输入 6 位二级密码。验证通过后，当前登录会话会自动获得 1 小时敏感操作权限。"
        onAuthorized={async () => {
          if (!pendingSensitiveAppId) {
            return;
          }

          await copyAppSecret(pendingSensitiveAppId, false);
        }}
        onClose={() => setPendingSensitiveAppId("")}
        open={Boolean(pendingSensitiveAppId)}
        operation={APP_LOG_SECRET_READ_OPERATION}
        title="验证后复制密钥"
      />
    </section>
  );
}
