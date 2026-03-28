import { Button, Input, Popconfirm } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router";

import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, makeNotice } from "../lib/format";

export default function AppsRoute() {
  const navigate = useNavigate();
  const {
    apps,
    selectedAppId,
    setSelectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
  } = useAdminSession();

  const [appId, setAppId] = useState("");
  const [appName, setAppName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deletingAppId, setDeletingAppId] = useState("");

  async function handleCreateApp(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
      setAppId("");
      setAppName("");
      setNotice(makeNotice("success", "App 已添加。"));
      navigate("/config");
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSubmitting(false);
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

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>应用管理</h1>
          <p>管理所有 App 项目空间。删除前必须先把配置清空为 `{}`。</p>
        </div>
      </header>

      <div className="page-grid">
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>应用列表</h2>
              <p>所有业务 App 项目空间都会出现在这里，并在顶部项目空间栏中可直接切换。</p>
            </div>
          </div>

          {apps.length ? (
            <div className="app-list">
              {apps.map((item) => (
                <article className="app-item" key={item.appId}>
                  <div>
                    <strong>{item.appName}</strong>
                    <p className="mono">{item.appId}</p>
                    <div className="inline-row">
                      <span className="status-chip">{item.status}</span>
                      {selectedAppId === item.appId ? <span className="meta-chip">当前项目空间</span> : null}
                    </div>
                  </div>

                  <div className="button-row">
                    <Button
                      onClick={() => {
                        setSelectedAppId(item.appId);
                        navigate("/config");
                      }}
                      type="default"
                    >
                      打开配置
                    </Button>
                    <Popconfirm
                      cancelText="取消"
                      disabled={!item.canDelete || deletingAppId === item.appId}
                      okText="删除"
                      onConfirm={() => void handleDeleteApp(item.appId)}
                      title={`确认删除 ${item.appName} (${item.appId})？`}
                    >
                      <Button danger disabled={!item.canDelete || deletingAppId === item.appId} loading={deletingAppId === item.appId} type="primary">
                        {item.canDelete ? "删除" : "不可删"}
                      </Button>
                    </Popconfirm>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">当前还没有业务 App，可先在右侧创建一个。</div>
          )}
        </section>

        <aside className="side-card">
          <div className="card-header">
            <div>
              <h2>新增 App</h2>
              <p>创建后会自动初始化默认配置，并生成一个新的 App 项目空间。</p>
            </div>
          </div>

          <form className="stack" onSubmit={handleCreateApp}>
            <label className="field">
              <span className="field-label">App ID</span>
              <Input
                disabled={submitting}
                onChange={(event) => setAppId(event.target.value)}
                placeholder="例如 app_a"
                size="large"
                value={appId}
              />
              <small className="field-hint">建议使用稳定、可读的技术 key。</small>
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
            </label>

            <Button htmlType="submit" loading={submitting} size="large" type="primary">
              {submitting ? "创建中..." : "创建 App"}
            </Button>
          </form>
        </aside>
      </div>
    </section>
  );
}
