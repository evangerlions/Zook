import { Segmented } from "antd";
import { useEffect, useMemo, useState } from "react";

import { LlmConfigTab } from "../components/llm-config-tab";
import { LlmMonitorTab } from "../components/llm-monitor-tab";
import { LlmSmokeTab } from "../components/llm-smoke-tab";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import {
  cloneLlmConfig,
  createDefaultLlmConfig,
  formatLlmConfigJson,
  getLlmDraftValidationError,
  normalizeLlmDocument,
  parseLlmConfigText,
  safeSerializeLlmDraft,
  serializeLlmDraft,
  serializeLlmDraftForPreview,
} from "../lib/llm-config";
import type {
  AdminLlmMetricsDocument,
  AdminLlmModelMetricsDocument,
  AdminLlmServiceDocument,
  AdminLlmSmokeTestDocument,
  LlmConfigDraft,
  LlmMetricsRange,
} from "../lib/types";

const LLM_TAB_OPTIONS: Array<{ label: string; value: "monitor" | "config" | "smoke" }> = [
  { label: "监控", value: "monitor" },
  { label: "冒烟测试", value: "smoke" },
  { label: "配置", value: "config" },
];

export default function LlmRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [tab, setTab] = useState<"monitor" | "config" | "smoke">("monitor");
  const [configMode, setConfigMode] = useState<"form" | "raw">("form");
  const [configSubTab, setConfigSubTab] = useState<"providers" | "models">("providers");
  const [document, setDocument] = useState<AdminLlmServiceDocument | null>(null);
  const [draft, setDraft] = useState<LlmConfigDraft>(createDefaultLlmConfig());
  const [originalDraft, setOriginalDraft] = useState<LlmConfigDraft>(createDefaultLlmConfig());
  const [rawValue, setRawValue] = useState(() => formatLlmConfigJson(createDefaultLlmConfig()));
  const [metrics, setMetrics] = useState<AdminLlmMetricsDocument | null>(null);
  const [modelMetrics, setModelMetrics] = useState<AdminLlmModelMetricsDocument | null>(null);
  const [smokeDocument, setSmokeDocument] = useState<AdminLlmSmokeTestDocument | null>(null);
  const [range, setRange] = useState<LlmMetricsRange>("24h");
  const [selectedProvider, setSelectedProvider] = useState("");
  const [selectedModelKey, setSelectedModelKey] = useState("");
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [loadingMetrics, setLoadingMetrics] = useState(false);
  const [saving, setSaving] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [runningSmokeTest, setRunningSmokeTest] = useState(false);
  const [desc, setDesc] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const [collapsedModels, setCollapsedModels] = useState<Set<string>>(() => new Set(draft.models.map((m) => m.key || "")));
  const allModelKeys = useMemo(() => draft.models.map((m) => m.key || ""), [draft.models]);
  const allCollapsed = allModelKeys.length > 0 && allModelKeys.every((key) => collapsedModels.has(key));

  function toggleModelCollapse(modelKey: string) {
    setCollapsedModels((current) => {
      const next = new Set(current);
      if (next.has(modelKey)) {
        next.delete(modelKey);
      } else {
        next.add(modelKey);
      }
      return next;
    });
  }

  function toggleAllModels() {
    if (allCollapsed) {
      setCollapsedModels(new Set());
    } else {
      setCollapsedModels(new Set(allModelKeys));
    }
  }
  const draftValidationError = useMemo(() => getLlmDraftValidationError(draft), [draft]);
  const rawValidation = useMemo(() => {
    try {
      return {
        ...parseLlmConfigText(rawValue),
        error: "",
      };
    } catch (error) {
      return {
        config: null,
        draft: null,
        normalizedText: "",
        error: formatApiError(error),
      };
    }
  }, [rawValue]);
  const draftSnapshot = useMemo(() => JSON.stringify(draft), [draft]);
  const rawDraftSnapshot = useMemo(
    () => (rawValidation.draft ? JSON.stringify(rawValidation.draft) : ""),
    [rawValidation.draft],
  );
  const activeConfigError = configMode === "raw" ? rawValidation.error : draftValidationError;

  function applyConfigDocument(payload: AdminLlmServiceDocument | null, preserveSelectedModel = true) {
    const nextDraft = cloneLlmConfig(payload?.config);
    const availableProviderKeys = payload?.config.providers.map((item) => item.key) ?? [];
    const availableModelKeys = payload?.config.models.map((item) => item.key) ?? [];
    const fallbackModelKey = payload?.config.defaultModelKey || payload?.config.models[0]?.key || "";

    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setRawValue(formatLlmConfigJson(payload?.config ?? nextDraft));
    setDesc("");
    setSelectedProvider((current) => (current && availableProviderKeys.includes(current) ? current : ""));
    setSelectedModelKey((current) => (
      preserveSelectedModel && current && availableModelKeys.includes(current) ? current : fallbackModelKey
    ));
  }

  async function loadConfig() {
    setLoadingConfig(true);
    try {
      applyConfigDocument(normalizeLlmDocument(await adminApi.getLlmService()));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function loadMetrics(nextRange: LlmMetricsRange, provider: string) {
    setLoadingMetrics(true);
    try {
      const payload = await adminApi.getLlmMetrics(nextRange, provider || undefined);
      setMetrics(payload);
      const nextModelKey = payload.models.some((item) => item.modelKey === selectedModelKey)
        ? selectedModelKey
        : payload.models[0]?.modelKey || "";
      setSelectedModelKey(nextModelKey);
      if (nextModelKey) {
        const detail = await adminApi.getLlmModelMetrics(nextModelKey, nextRange, provider || undefined);
        setModelMetrics(detail);
      } else {
        setModelMetrics(null);
      }
    } finally {
      setLoadingMetrics(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  useEffect(() => {
    void loadMetrics(range, selectedProvider);
  }, [range, selectedProvider]);

  useEffect(() => {
    if (configMode !== "raw" || rawValidation.error || !rawValidation.draft || rawDraftSnapshot === draftSnapshot) {
      return;
    }

    setDraft(rawValidation.draft);
  }, [configMode, draftSnapshot, rawDraftSnapshot, rawValidation.draft, rawValidation.error]);

  useEffect(() => {
    if (configMode === "raw") {
      return;
    }

    setRawValue(formatLlmConfigJson(draft));
  }, [configMode, draft]);

  const previewValue = useMemo(
    () => (configMode === "raw" ? rawValidation.config : serializeLlmDraftForPreview(draft)),
    [configMode, draft, rawValidation.config],
  );
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
      const nextConfig = configMode === "raw" ? parseLlmConfigText(rawValue).config : serializeLlmDraft(draft);
      const payload = normalizeLlmDocument(
        await adminApi.updateLlmService({
          ...nextConfig,
          desc: desc.trim() || undefined,
        }),
      );
      applyConfigDocument(payload);
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "LLM 配置已保存。"));
      await loadMetrics(range, selectedProvider);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoadingConfig(true);
    try {
      applyConfigDocument(normalizeLlmDocument(await adminApi.getLlmServiceRevision(revision)), false);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoadingConfig(false);
    }
  }

  async function handleRequestRestoreRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const [latestPayload, revisionPayload] = await Promise.all([
        adminApi.getLlmService(),
        adminApi.getLlmServiceRevision(revision),
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
      const payload = normalizeLlmDocument(await adminApi.restoreLlmService(restoreRevision, restoreDesc.trim() || undefined));
      applyConfigDocument(payload, false);
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      await loadMetrics(range, selectedProvider);
      setNotice(makeNotice("success", `已恢复到版本 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleRunSmokeTest() {
    setRunningSmokeTest(true);
    clearNotice();
    try {
      const payload = await adminApi.runLlmSmokeTest();
      setSmokeDocument(payload);
      setNotice(
        makeNotice(
          "success",
          `冒烟测试完成：成功 ${payload.summary.successCount}，失败 ${payload.summary.failureCount}，跳过 ${payload.summary.skippedCount}。`,
        ),
      );
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRunningSmokeTest(false);
    }
  }

  async function handleSelectModel(nextModelKey: string) {
    setSelectedModelKey(nextModelKey);
    if (!nextModelKey) {
      setModelMetrics(null);
      return;
    }

    try {
      setModelMetrics(await adminApi.getLlmModelMetrics(nextModelKey, range, selectedProvider || undefined));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    }
  }

  function copyPreview() {
    const text = typeof previewValue === "string"
      ? previewValue
      : JSON.stringify(previewValue, null, 2);
    navigator.clipboard.writeText(text).then(() => {
      setNotice(makeNotice("success", "已复制到剪贴板。"));
    });
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>LLM</h1>
          <p>统一管理 `common.llm_service` 的供应商、模型路由、监控指标和冒烟测试。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
        </div>
      </header>

      <div className="tab-row">
        <Segmented
          className="page-segmented"
          onChange={(value) => setTab(value as "monitor" | "config" | "smoke")}
          options={LLM_TAB_OPTIONS}
          value={tab}
        />
      </div>

      {tab === "monitor" ? (
        <LlmMonitorTab
          loadingMetrics={loadingMetrics}
          metrics={metrics}
          modelMetrics={modelMetrics}
          onProviderChange={setSelectedProvider}
          onRangeChange={setRange}
          onSelectModel={(modelKey) => void handleSelectModel(modelKey)}
          providerOptions={metrics?.providers ?? []}
          range={range}
          selectedProvider={selectedProvider}
          selectedModelKey={selectedModelKey}
        />
      ) : tab === "smoke" ? (
        <LlmSmokeTab
          onRunSmokeTest={() => void handleRunSmokeTest()}
          runningSmokeTest={runningSmokeTest}
          smokeDocument={smokeDocument}
        />
      ) : (
        <LlmConfigTab
          activeConfigError={activeConfigError}
          allCollapsed={allCollapsed}
          collapsedModels={collapsedModels}
          configMode={configMode}
          configSubTab={configSubTab}
          document={document}
          draft={draft}
          draftValidationError={draftValidationError}
          historyExpanded={historyExpanded}
          loadingConfig={loadingConfig}
          onBackToLatest={() => void loadConfig()}
          onConfigModeChange={setConfigMode}
          onConfigSubTabChange={setConfigSubTab}
          onCopyPreview={copyPreview}
          onDraftChange={(updater) => setDraft(updater)}
          onRawValueChange={setRawValue}
          onRefresh={() => void loadConfig()}
          onRequestSave={openSaveModal}
          onRestoreRevision={(revision) => void handleRequestRestoreRevision(revision)}
          onSelectRevision={(revision) => void handleViewRevision(revision)}
          onToggleAllModels={toggleAllModels}
          onToggleHistory={() => setHistoryExpanded((current) => !current)}
          onToggleModel={toggleModelCollapse}
          previewValue={previewValue}
          rawValidationError={rawValidation.error}
          rawValue={rawValue}
          restoringRevision={restoringRevision}
          saving={saving}
        />
      )}

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：新增模型路由或调整权重"
        loading={saving}
        newValue={configMode === "raw" ? rawValidation.normalizedText : JSON.stringify(safeSerializeLlmDraft(draft), null, 2)}
        oldValue={JSON.stringify(safeSerializeLlmDraft(originalDraft), null, 2)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存 LLM 配置"
      />
      <SaveConfirmModal
        desc={restoreDesc}
        descPlaceholder="例如：误修改后回滚到稳定版本"
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
