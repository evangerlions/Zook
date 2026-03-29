import {
  CopyOutlined,
  DeleteOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { Button, Input, Modal, Popconfirm, Tooltip } from "antd";
import { useEffect, useState } from "react";

import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { ApiError, adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";

const APP_LOG_SECRET_READ_OPERATION = "app.log_secret.read";

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
  const [appName, setAppName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [deletingAppId, setDeletingAppId] = useState("");
  const [copyingAppId, setCopyingAppId] = useState("");
  const [pendingSensitiveAppId, setPendingSensitiveAppId] = useState("");

  function closeCreateModal() {
    setCreateModalOpen(false);
    setAppId("");
    setAppName("");
  }

  async function handleCreateApp() {
    if (!appId.trim()) {
      setNotice(makeNotice("error", "请输入 App ID。"));
      return;
    }

    setSubmitting(true);
    clearNotice();
    try {
      const payload = await adminApi.createApp(appId.trim(), appName.trim() || undefined);
      await reloadBootstrap();
      setSelectedAppId(payload.appId);
      closeCreateModal();
      setNotice(makeNotice("success", "App 已添加，并已自动生成密钥。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSubmitting(false);
    }
  }

  async function writeClipboard(value: string) {
    if (!navigator?.clipboard?.writeText) {
      throw new Error("当前浏览器不支持剪贴板写入。");
    }

    await navigator.clipboard.writeText(value);
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
              `Key ID` 是密钥编号，`密钥` 是实际 secret；复制按钮只会复制完整密钥值，不会附带 `Key ID`。
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
                  return (
                    <tr key={item.appId}>
                      <td>
                        <div className="table-primary-cell">
                          <strong>{item.appName}</strong>
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
        okButtonProps={{ loading: submitting }}
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
              disabled={submitting}
              onChange={(event) => setAppId(event.target.value)}
              placeholder="例如 app_a"
              size="large"
              value={appId}
            />
            <small className="field-hint">建议使用稳定、可读的技术代号，创建后会写入默认 config。</small>
          </label>

          <label className="field">
            <span className="field-label">App 名称</span>
            <Input
              disabled={submitting}
              onChange={(event) => setAppName(event.target.value)}
              placeholder="展示名称，可选"
              size="large"
              value={appName}
            />
            <small className="field-hint">创建完成后会自动生成密钥和默认配置。</small>
          </label>
        </div>
      </Modal>

      <SensitiveOperationModal
        description="为了复制完整密钥，需要先完成一次邮箱验证码校验。验证通过后，当前登录会话会自动获得 1 小时敏感操作权限。"
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
