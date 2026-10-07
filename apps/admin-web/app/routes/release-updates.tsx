import { Alert, Button, Collapse, Input } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { parseConfigText, safeParseJson } from "../lib/json";
import { useAdminSession } from "../lib/admin-session";
import type { AdminReleaseUpdateDocument } from "../lib/types";

const DEFAULT_CONFIG = JSON.stringify({ schemaVersion: 1, products: {} }, null, 2);

export default function ReleaseUpdatesRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] = useState<AdminReleaseUpdateDocument | null>(null);
  const [value, setValue] = useState(DEFAULT_CONFIG);
  const [originalValue, setOriginalValue] = useState(DEFAULT_CONFIG);
  const [desc, setDesc] = useState("");
  const [editorError, setEditorError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const previewValue = useMemo(() => safeParseJson(value), [value]);

  function applyDocument(next: AdminReleaseUpdateDocument) {
    const normalized = JSON.stringify(next.config, null, 2);
    setDocument(next);
    setValue(normalized);
    setOriginalValue(normalized);
    setDesc("");
    setEditorError("");
  }

  async function loadLatest() {
    setLoading(true);
    try {
      applyDocument(await adminApi.getReleaseUpdates());
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, []);

  function handleEditorChange(nextValue: string) {
    setValue(nextValue);
    try {
      parseConfigText(nextValue);
      setEditorError("");
    } catch (error) {
      setEditorError(formatApiError(error));
    }
  }

  function openSaveModal() {
    if (editorError) return;
    try {
      parseConfigText(value);
      setSaveModalOpen(true);
    } catch (error) {
      const message = formatApiError(error);
      setEditorError(message);
      setNotice(makeNotice("error", message));
    }
  }

  async function handleConfirmSave() {
    setSaving(true);
    clearNotice();
    try {
      const config = parseConfigText(value);
      applyDocument(await adminApi.updateReleaseUpdates(config, desc.trim() || undefined));
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "应用更新配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      applyDocument(await adminApi.getReleaseUpdatesRevision(revision));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRestore(revision: number) {
    setLoading(true);
    clearNotice();
    try {
      const [latest, selected] = await Promise.all([
        adminApi.getReleaseUpdates(),
        adminApi.getReleaseUpdatesRevision(revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(JSON.stringify(latest.config, null, 2));
      setRestoreNewValue(JSON.stringify(selected.config, null, 2));
      setRestoreDesc(`回滚到版本 R${revision}`);
      setRestoreModalOpen(true);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirmRestore() {
    if (!restoreRevision) return;
    setSaving(true);
    clearNotice();
    try {
      applyDocument(await adminApi.restoreReleaseUpdates(restoreRevision, restoreDesc.trim() || undefined));
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>应用更新</h1>
          <p>统一维护所有产品的发布产物；公开接口只会返回请求产品自己的平台与商店配置。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
          <Button disabled={loading} onClick={() => void loadLatest()}>刷新</Button>
        </div>
      </header>

      <Alert
        description="每个 target 用 platform + channel 区分版本：download 需要 downloadUrl，store 需要 storeUrl；latest.messageI18n 可选配置各语言更新提示，未配置时客户端不显示替代文案；mandatory 和 minimumSupported 由客户端用于强制升级判断；reminder.maxCount 控制最多提醒次数（0 为不限），reminder.intervalSeconds 控制提醒间隔。experiments 只下发启用中的实验包。"
        message="配置提示"
        type="info"
        showIcon
      />

      <section className="surface-card collapse-card">
        <Collapse
          className="config-collapse"
          defaultActiveKey={[]}
          items={[{
            key: "structure-preview",
            label: "结构预览",
            children: editorError ? <div className="empty-state">JSON 语法错误，暂时无法预览。</div> : <JsonPreview value={previewValue} />,
          }]}
        />
      </section>

      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <section className="surface-card">
          <div className="card-header">
            <div>
              <h2>全局发布目录</h2>
              <p className="mono">common.release_updates</p>
            </div>
            {!document?.isLatest ? <Button onClick={() => void loadLatest()}>回到最新</Button> : null}
          </div>
          {loading ? <p className="meta-text">正在加载应用更新配置...</p> : null}
          <label className="field">
            <span className="field-label">JSON 配置</span>
            <JsonEditor onChange={handleEditorChange} readOnly={loading || saving} value={value} />
            {editorError ? <small className="form-error">{editorError}</small> : <small className="field-hint">保存时会进行版本格式、平台、URL、摘要和实验包校验。</small>}
          </label>
          <label className="field">
            <span className="field-label">Revision Desc</span>
            <Input onChange={(event) => setDesc(event.target.value)} placeholder="例如：发布 1.5.0 Android 直下载包" size="large" value={desc} />
          </label>
          <div className="button-row">
            <Button disabled={loading || saving || Boolean(editorError)} onClick={openSaveModal} size="large" type="primary">保存应用更新配置</Button>
          </div>
        </section>

        <RevisionHistoryDock expanded={historyExpanded} onToggle={() => setHistoryExpanded((current) => !current)}>
          <RevisionList
            activeRevision={document?.revision}
            compact
            latestRevision={document?.revisions?.[0]?.revision}
            loadingRevision={restoreRevision}
            onRestore={(revision) => void handleRequestRestore(revision)}
            onSelect={(revision) => void handleViewRevision(revision)}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：新增 AINovel Windows 1.5.0 安装包"
        loading={saving}
        newValue={value}
        oldValue={originalValue}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存应用更新配置"
      />
      <SaveConfirmModal
        autoGenerateDesc={false}
        desc={restoreDesc}
        descPlaceholder="例如：回滚到上一版发布目录"
        loading={saving}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreRevision(null);
          setRestoreDesc("");
        }}
        onConfirm={() => void handleConfirmRestore()}
        onDescChange={setRestoreDesc}
        okText="确认回滚"
        open={restoreModalOpen}
        title={restoreRevision ? `确认回滚到版本 R${restoreRevision}` : "确认回滚"}
      />
    </section>
  );
}
