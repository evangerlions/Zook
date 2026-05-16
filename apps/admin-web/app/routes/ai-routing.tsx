import { Button, Collapse, Input } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { parseConfigText, safeParseJson } from "../lib/json";
import type { AdminAiRoutingDocument } from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";

export default function AiRoutingRoute() {
  const {
    apps,
    selectedAppId,
    reloadBootstrap,
    setNotice,
    clearNotice,
    completeWorkspaceTransition,
  } = useAdminSession();

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID) ?? null;
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminAiRoutingDocument | null>(null);
  const [value, setValue] = useState("");
  const [originalValue, setOriginalValue] = useState("");
  const [desc, setDesc] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [editorError, setEditorError] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const previewValue = useMemo(() => safeParseJson(value), [value]);

  async function loadLatest() {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setDocument(null);
      setValue("");
      setOriginalValue("");
      setDesc("");
      setEditorError("");
      completeWorkspaceTransition();
      return;
    }

    setLoading(true);
    try {
      const payload = await adminApi.getAiRouting(AI_NOVEL_APP_ID);
      setDocument(payload);
      setValue(payload.rawJson);
      setOriginalValue(payload.rawJson);
      setDesc("");
      setEditorError("");
    } finally {
      setLoading(false);
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId]);

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      const payload = await adminApi.getAiRoutingRevision(AI_NOVEL_APP_ID, revision);
      setDocument(payload);
      setValue(payload.rawJson);
      setEditorError("");
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
        adminApi.getAiRouting(AI_NOVEL_APP_ID),
        adminApi.getAiRoutingRevision(AI_NOVEL_APP_ID, revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(latestPayload.rawJson);
      setRestoreNewValue(revisionPayload.rawJson);
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
      const payload = await adminApi.restoreAiRouting(
        AI_NOVEL_APP_ID,
        restoreRevision,
        restoreDesc.trim() || undefined,
      );
      setDocument(payload);
      setValue(payload.rawJson);
      setOriginalValue(payload.rawJson);
      setDesc("");
      setEditorError("");
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      await reloadBootstrap();
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  function openSaveModal() {
    try {
      parseConfigText(value);
      setEditorError("");
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
      const parsed = parseConfigText(value);
      const normalized = JSON.stringify(parsed, null, 2);
      const payload = await adminApi.updateAiRouting(AI_NOVEL_APP_ID, normalized, desc.trim() || undefined);
      setDocument(payload);
      setValue(payload.rawJson);
      setOriginalValue(payload.rawJson);
      setDesc("");
      setEditorError("");
      setSaveModalOpen(false);
      await reloadBootstrap();
      setNotice(makeNotice("success", "AI Routing 配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  if (!aiNovelApp) {
    return (
      <section className="empty-state">
        当前工作区中还没有 `ai_novel` 项目，暂时无法配置 AI Routing。
      </section>
    );
  }

  if (selectedApp?.appId !== AI_NOVEL_APP_ID) {
    return (
      <section className="empty-state">
        AI Routing 目前只支持 `ai_novel`。请先在项目空间切换到 `ai_novel` 再编辑。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>AI Routing</h1>
          <p>这里维护 `ai_novel.model_routing` 的 RAW JSON，控制 taskType 到逻辑 modelKey 的默认映射。</p>
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

      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <section className="editor-card">
          <div className="card-header">
            <div>
              <h2>{aiNovelApp.appName}</h2>
              <p className="mono">{AI_NOVEL_APP_ID}</p>
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
              <small className="field-hint">当前只提供 RAW JSON 编辑，保存时会自动格式化。</small>
              {editorError ? <small className="form-error">{editorError}</small> : null}
            </label>

            <div className="button-row">
              <Button disabled={loading} onClick={openSaveModal} size="large" type="primary">
                保存配置
              </Button>
            </div>

            <label className="field">
              <span className="field-label">版本说明</span>
              <Input
                onChange={(event) => setDesc(event.target.value)}
                placeholder="例如：切换 ai_novel 默认创作模型"
                size="large"
                value={desc}
              />
            </label>
          </div>
        </section>

        <RevisionHistoryDock
          expanded={historyExpanded}
          onToggle={() => setHistoryExpanded((current) => !current)}
          title="AI Routing 版本历史"
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
        descPlaceholder="例如：切换 ai_novel 默认创作模型"
        loading={saving}
        newValue={value}
        oldValue={originalValue}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存 AI Routing"
      />

      <SaveConfirmModal
        desc={restoreDesc}
        descPlaceholder="例如：恢复 ai_novel 默认路由"
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
        autoGenerateDesc={false}
      />
    </section>
  );
}
