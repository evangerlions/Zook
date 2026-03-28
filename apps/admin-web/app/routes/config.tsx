import { Button, Collapse, Input } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { RevisionList } from "../components/revision-list";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { parseConfigText, safeParseJson } from "../lib/json";
import type { AdminConfigDocument } from "../lib/types";

export default function ConfigRoute() {
  const {
    apps,
    selectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
  } = useAdminSession();

  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminConfigDocument | null>(null);
  const [value, setValue] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [editorError, setEditorError] = useState("");
  const previewValue = useMemo(() => safeParseJson(value), [value]);

  async function loadLatest() {
    if (!selectedAppId) {
      setDocument(null);
      setValue("");
      setDesc("");
      setEditorError("");
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.getConfig(selectedAppId);
      setDocument(payload);
      setValue(payload.rawJson);
      setDesc("");
      setEditorError("");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId]);

  async function handleViewRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.getConfigRevision(selectedAppId, revision);
      setDocument(payload);
      setValue(payload.rawJson);
      setEditorError("");
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreRevision(revision: number) {
    if (!selectedAppId) {
      return;
    }

    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = await adminApi.restoreConfig(selectedAppId, revision);
      setDocument(payload);
      setValue(payload.rawJson);
      setDesc("");
      setEditorError("");
      await reloadBootstrap();
      setNotice(makeNotice("success", `已恢复到版本 R${revision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleSave() {
    if (!selectedAppId) {
      setNotice(makeNotice("error", "请先选择一个 App。"));
      return;
    }

    setSaving(true);
    clearNotice();
    try {
      const parsed = parseConfigText(value);
      const normalized = JSON.stringify(parsed, null, 2);
      const payload = await adminApi.updateConfig(selectedAppId, normalized, desc.trim() || undefined);
      setDocument(payload);
      setValue(payload.rawJson);
      setDesc("");
      setEditorError("");
      await reloadBootstrap();
      setNotice(makeNotice("success", "配置已保存。"));
    } catch (error) {
      const message = formatApiError(error);
      setEditorError(message);
      setNotice(makeNotice("error", message));
    } finally {
      setSaving(false);
    }
  }

  if (!selectedApp) {
    return (
      <section className="empty-state">
        请先在“应用管理”中创建或选择一个 App，再编辑它的 `admin.delivery_config`。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>配置管理</h1>
          <p>当前项目空间为 {selectedApp.appName}，这里直接编辑 `admin.delivery_config` 的 JSON 配置与版本说明。</p>
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
              children: editorError ? (
                <div className="empty-state">JSON 语法错误，暂时无法预览。</div>
              ) : (
                <JsonPreview value={previewValue} />
              ),
            },
          ]}
        />
      </section>

      <div className="page-grid page-grid--config">
        <section className="editor-card">
          <div className="card-header">
            <div>
              <h2>{selectedApp.appName}</h2>
              <p className="mono">{selectedApp.appId}</p>
            </div>
            <div className="top-actions">
              <span className="meta-chip">
                {document?.revision ? `R${document.revision}` : "未保存"}
              </span>
              <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
              {!document?.isLatest ? (
                <Button onClick={() => void loadLatest()} type="default">
                  回到最新
                </Button>
              ) : null}
            </div>
          </div>

          <div className="stack">
            <label className="field">
              <span className="field-label">JSON 配置</span>
              <JsonEditor
                onChange={(nextValue) => {
                  setValue(nextValue);
                  try {
                    parseConfigText(nextValue);
                    setEditorError("");
                  } catch (error) {
                    setEditorError(formatApiError(error));
                  }
                }}
                readOnly={loading}
                value={value}
              />
              <small className="field-hint">支持直接粘贴 JSON，保存时会自动做标准化格式化。</small>
              {editorError ? <small className="form-error">{editorError}</small> : null}
            </label>

            <label className="field">
              <span className="field-label">更新说明</span>
              <Input
                onChange={(event) => setDesc(event.target.value)}
                placeholder="例如：新增投递渠道白名单"
                size="large"
                value={desc}
              />
            </label>

            <div className="button-row">
              <Button disabled={loading} loading={saving} onClick={() => void handleSave()} size="large" type="primary">
                {saving ? "保存中..." : "保存配置"}
              </Button>
              <Button disabled={loading} onClick={() => void loadLatest()} size="large" type="default">
                刷新最新
              </Button>
            </div>
          </div>
        </section>

        <aside className="side-card">
          <Collapse
            className="config-collapse config-collapse-history"
            defaultActiveKey={["revision-history"]}
            items={[
            {
              key: "revision-history",
              label: "版本历史",
              children: (
                <RevisionList
                    activeRevision={document?.revision}
                    compact
                    loadingRevision={restoringRevision}
                    onRestore={(revision) => void handleRestoreRevision(revision)}
                    onSelect={(revision) => void handleViewRevision(revision)}
                    revisions={document?.revisions ?? []}
                  />
                ),
              },
            ]}
          />
        </aside>
      </div>
    </section>
  );
}
