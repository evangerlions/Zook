import { Button, Collapse } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "./json-editor";
import { RevisionHistoryDock } from "./revision-history-dock";
import { RevisionList } from "./revision-list";
import { SaveConfirmModal } from "./save-confirm-modal";
import { AiNovelModelWeightFields } from "./ai-novel-model-weight-fields";
import { AiNovelModelHealthTable } from "./ai-novel-model-health-table";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { parseAiNovelModelSelectionText } from "../lib/ai-novel-model-selection";
import type {
  AdminAiNovelModelSelectionDocument,
  AiNovelModelSelectionConfig,
} from "../lib/types";

function configJson(config: AiNovelModelSelectionConfig): string {
  return JSON.stringify(config, null, 2);
}

export function AiNovelModelSelectionPanel() {
  const { clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] =
    useState<AdminAiNovelModelSelectionDocument | null>(null);
  const [weightedModels, setWeightedModels] = useState<
    AiNovelModelSelectionConfig["chat"]["default"]
  >([]);
  const [rawValue, setRawValue] = useState("");
  const [rawError, setRawError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");

  const nextConfig = useMemo<AiNovelModelSelectionConfig | null>(() => {
    if (!document || weightedModels.length === 0) {
      return null;
    }
    return {
      ...document.config,
      chat: {
        default: weightedModels,
      },
    };
  }, [document, weightedModels]);

  function applyDocument(payload: AdminAiNovelModelSelectionDocument) {
    const value = configJson(payload.config);
    setDocument(payload);
    setWeightedModels(payload.config.chat.default.map((item) => ({ ...item })));
    setRawValue(value);
    try {
      parseAiNovelModelSelectionText(
        value,
        payload.availableChatModels.map((model) => model.key),
      );
      setRawError("");
    } catch (error) {
      setRawError(formatApiError(error));
    }
  }

  function validateRawValue(value: string): AiNovelModelSelectionConfig {
    return parseAiNovelModelSelectionText(
      value,
      document?.availableChatModels.map((model) => model.key) ?? [],
    );
  }

  function handleWeightedModelsChange(
    items: AiNovelModelSelectionConfig["chat"]["default"],
  ) {
    setWeightedModels(items);
    const value = configJson({ schemaVersion: 1, chat: { default: items } });
    setRawValue(value);
    try {
      validateRawValue(value);
      setRawError("");
    } catch (error) {
      setRawError(formatApiError(error));
    }
  }

  function handleRawValueChange(value: string) {
    setRawValue(value);
    try {
      const config = validateRawValue(value);
      setWeightedModels(config.chat.default.map((item) => ({ ...item })));
      setRawError("");
    } catch (error) {
      setRawError(formatApiError(error));
    }
  }

  async function loadLatest() {
    setLoading(true);
    try {
      applyDocument(await adminApi.getAiNovelModelSelection());
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, []);

  async function handleConfirmSave() {
    if (!nextConfig) {
      return;
    }
    setSaving(true);
    clearNotice();
    try {
      applyDocument(
        await adminApi.updateAiNovelModelSelection(
          nextConfig,
          desc.trim() || undefined,
        ),
      );
      setDesc("");
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "AINovel 文本模型权重已更新。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      applyDocument(await adminApi.getAiNovelModelSelectionRevision(revision));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRequestRestore(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const [latest, target] = await Promise.all([
        adminApi.getAiNovelModelSelection(),
        adminApi.getAiNovelModelSelectionRevision(revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(configJson(latest.config));
      setRestoreNewValue(configJson(target.config));
      setRestoreDesc(`恢复到版本 R${revision}`);
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
      applyDocument(
        await adminApi.restoreAiNovelModelSelection(
          restoreRevision,
          restoreDesc.trim() || undefined,
        ),
      );
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(
        makeNotice("success", `AINovel 模型配置已恢复到 R${restoreRevision}。`),
      );
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  const currentConfigJson = document ? configJson(document.config) : "{}";
  const nextConfigJson = nextConfig ? configJson(nextConfig) : currentConfigJson;
  const unchanged = currentConfigJson === nextConfigJson;
  const totalWeight = weightedModels.reduce((sum, item) => sum + item.weight, 0);
  const modelKeys = weightedModels.map((item) => item.modelKey);
  const weightsInvalid =
    weightedModels.length === 0 ||
    weightedModels.some((item) => !item.modelKey || item.weight < 0) ||
    new Set(modelKeys).size !== modelKeys.length ||
    Math.abs(totalWeight - 100) > 0.001;

  return (
    <>
      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <section className="editor-card">
          <div className="card-header">
            <div>
              <h2>AINovel 文本生成模型</h2>
              <p className="mono">ai_novel.model_selection</p>
            </div>
            <div className="top-actions">
              <span className="meta-chip">
                {document?.revision ? `R${document.revision}` : "代码默认值"}
              </span>
              <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
              {document && !document.isLatest ? (
                <Button onClick={() => void loadLatest()}>回到最新</Button>
              ) : null}
            </div>
          </div>

          <div className="stack">
            <AiNovelModelWeightFields
              disabled={loading || !document?.isLatest}
              items={weightedModels}
              models={document?.availableChatModels ?? []}
              onChange={handleWeightedModelsChange}
            />
            <small className="field-hint">
              这里只配置 AINovel 选择逻辑模型的基础权重；Weight 为 0 表示关闭该模型。运行时会结合 LLM Service 健康分动态调整，健康为 0 的已启用模型使用 0.01% 权重因子进行探测。Provider、上游模型和密钥仍由 Server → LLM 管理。
            </small>

            <div className="button-row">
              <Button
                disabled={
                  loading ||
                  unchanged ||
                  weightsInvalid ||
                  Boolean(rawError) ||
                  !document?.isLatest
                }
                onClick={() => setSaveModalOpen(true)}
                type="primary"
              >
                保存模型选择
              </Button>
              <Button disabled={loading} onClick={() => void loadLatest()}>
                刷新最新
              </Button>
            </div>

            {document ? <AiNovelModelHealthTable items={document.modelHealth} /> : null}

            <Collapse
              items={[
                {
                  key: "selection-json",
                  label: "配置 JSON",
                  children: (
                    <label className="field">
                      <span className="field-label">JSON 配置</span>
                      <JsonEditor
                        onChange={handleRawValueChange}
                        readOnly={loading || !document?.isLatest}
                        value={rawValue}
                      />
                      {rawError ? (
                        <small className="form-error">{rawError}</small>
                      ) : (
                        <small className="field-hint">
                          JSON 校验通过，可以保存；修改会同步到上方模型权重表单。
                        </small>
                      )}
                    </label>
                  ),
                },
              ]}
            />
          </div>
        </section>

        <RevisionHistoryDock
          expanded={historyExpanded}
          onToggle={() => setHistoryExpanded((current) => !current)}
          title="模型配置版本"
        >
          <RevisionList
            activeRevision={document?.revision}
            compact
            latestRevision={document?.revisions[0]?.revision}
            loadingRevision={restoringRevision}
            onRestore={(revision) => void handleRequestRestore(revision)}
            onSelect={(revision) => void handleViewRevision(revision)}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：调整 AINovel 文本模型流量权重"
        loading={saving}
        newValue={nextConfigJson}
        oldValue={currentConfigJson}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="确认调整 AINovel 模型权重"
      />

      <SaveConfirmModal
        desc={restoreDesc}
        loading={Boolean(restoreRevision) && restoringRevision === restoreRevision}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => {
          setRestoreModalOpen(false);
          setRestoreRevision(null);
        }}
        onConfirm={() => void handleConfirmRestore()}
        onDescChange={setRestoreDesc}
        open={restoreModalOpen}
        title={restoreRevision ? `确认恢复到版本 R${restoreRevision}` : "确认恢复"}
      />
    </>
  );
}
