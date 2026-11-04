import { Button, InputNumber, Table, Tag, Tooltip } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";

import { RevisionHistoryDock } from "./revision-history-dock";
import { RevisionList } from "./revision-list";
import { SaveConfirmModal } from "./save-confirm-modal";
import { CreditContextTiersEditor } from "./credit-context-tiers-editor";
import { createRows, hasInvalidRates, toConfig, type PricingRow } from "../lib/credit-pricing-editor";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminAiNovelModelPointPricingDocument,
  AiNovelModelPointPricingConfig,
} from "../lib/types";

function configJson(config: AiNovelModelPointPricingConfig): string {
  return JSON.stringify({
    ...config,
    models: [...config.models].sort((left, right) => left.modelKey.localeCompare(right.modelKey)),
  }, null, 2);
}

export function AiNovelModelPointPricingPanel() {
  const { clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] = useState<AdminAiNovelModelPointPricingDocument | null>(null);
  const [rows, setRows] = useState<PricingRow[]>([]);
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

  function applyDocument(payload: AdminAiNovelModelPointPricingDocument) {
    setDocument(payload);
    setRows(createRows(payload));
  }

  async function loadLatest() {
    setLoading(true);
    try {
      applyDocument(await adminApi.getAiNovelModelPointPricing());
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadLatest(); }, []);

  const nextConfig = useMemo(() => toConfig(rows), [rows]);
  const currentConfigJson = document ? configJson(document.config) : "{}";
  const nextConfigJson = configJson(nextConfig);
  const invalidRates = hasInvalidRates(rows);

  function updateRate(
    modelKey: string,
    field: "inputPointsPerMillionTokens" | "outputPointsPerMillionTokens" | "cachedInputPointsPerMillionTokens",
    value: number | null,
  ) {
    setRows((items) => items.map((row) => row.key === modelKey
      ? { ...row, [field]: value ?? undefined }
      : row));
  }

  async function confirmSave() {
    setSaving(true);
    clearNotice();
    try {
      applyDocument(await adminApi.updateAiNovelModelPointPricing(nextConfig, desc.trim() || undefined));
      setDesc("");
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "AINovel 模型点数费率已更新。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function viewRevision(revision: number) {
    setLoading(true);
    try {
      applyDocument(await adminApi.getAiNovelModelPointPricingRevision(revision));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function requestRestore(revision: number) {
    setRestoringRevision(revision);
    try {
      const [latest, target] = await Promise.all([
        adminApi.getAiNovelModelPointPricing(),
        adminApi.getAiNovelModelPointPricingRevision(revision),
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

  async function confirmRestore() {
    if (!restoreRevision) return;
    setRestoringRevision(restoreRevision);
    try {
      applyDocument(await adminApi.restoreAiNovelModelPointPricing(restoreRevision, restoreDesc.trim() || undefined));
      setRestoreModalOpen(false);
      setRestoreRevision(null);
      setRestoreDesc("");
      setNotice(makeNotice("success", `AINovel 模型点数费率已恢复到 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  const columns: ColumnsType<PricingRow> = [
    {
      title: "模型",
      key: "model",
      render: (_, row) => (
        <div className="stack" style={{ gap: 2 }}>
          <strong>{row.label}</strong>
          <code>{row.key}</code>
          <small>{row.kind === "embedding" ? "Embedding" : "Chat"}{row.configuredAvailable ? " · 已配置可用路由" : " · 当前没有可用路由"}</small>
        </div>
      ),
    },
    {
      title: "定价参考 / 1M tokens",
      key: "reference",
      render: (_, row) => {
        const reference = row.reference;
        const referencePrice = reference.inputUsdPerMillionTokens === undefined
          ? "未找到对应价格"
          : `$${reference.inputUsdPerMillionTokens} / $${reference.outputUsdPerMillionTokens}`;
        return (
          <div className="stack" style={{ gap: 4 }}>
            <span>
              {reference.source === "product" ? <Tag>产品费率</Tag> : <Tag>OpenRouter</Tag>}
              {reference.match === "approximate" ? <Tag color="orange">近似参考</Tag> : null}
              {reference.match === "unavailable" ? <Tag>无匹配</Tag> : null}
              {reference.url ? <a href={reference.url} rel="noreferrer" target="_blank">{reference.modelId}</a> : reference.modelId ?? "—"}
            </span>
            <span>{referencePrice}</span>
            {reference.note ? <Tooltip title={reference.note}><small className="field-hint">价格备注ⓘ</small></Tooltip> : null}
          </div>
        );
      },
    },
    {
      title: "未缓存输入倍率",
      dataIndex: "inputPointsPerMillionTokens",
      key: "input-rate",
      width: 190,
      render: (value: number | undefined, row) => (
        <InputNumber
          aria-label={`${row.key} 输入点数费率`}
          disabled={loading || !document?.isLatest}
          min={0}
          onChange={(next) => updateRate(row.key, "inputPointsPerMillionTokens", next === null ? null : Math.round(next * 100))}
          precision={1}
          step={0.1}
          value={value === undefined ? undefined : value / 100}
        />
      ),
    },
    {
      title: "输出倍率",
      dataIndex: "outputPointsPerMillionTokens",
      key: "output-rate",
      width: 190,
      render: (value: number | undefined, row) => (
        <InputNumber
          aria-label={`${row.key} 输出点数费率`}
          disabled={loading || !document?.isLatest}
          min={0}
          onChange={(next) => updateRate(row.key, "outputPointsPerMillionTokens", next === null ? null : Math.round(next * 100))}
          precision={1}
          step={0.1}
          value={value === undefined ? undefined : value / 100}
        />
      ),
    },
  ];
  columns.splice(2, 0, {
    title: "缓存输入倍率", key: "cached-input-rate", width: 190,
    render: (_, row) => <InputNumber aria-label={`${row.key} 缓存输入倍率`}
      disabled={loading || !document?.isLatest} min={0} precision={1} step={0.1}
      placeholder="按未缓存输入"
      value={row.cachedInputPointsPerMillionTokens === undefined ? undefined : row.cachedInputPointsPerMillionTokens / 100}
      onChange={(next) => updateRate(row.key, "cachedInputPointsPerMillionTokens", next === null ? null : Math.round(next * 100))} />,
  });

  return (
    <>
      <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
        <section className="editor-card">
          <div className="card-header">
            <div>
              <h2>AINovel 模型点数费率</h2>
              <p className="mono">ai_novel.model_point_pricing</p>
            </div>
            <div className="top-actions">
              <span className="meta-chip">{document?.revision ? `R${document.revision}` : "代码默认值"}</span>
              <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
              {document && !document.isLatest ? <Button onClick={() => void loadLatest()}>回到最新</Button> : null}
            </div>
          </div>

          <div className="stack">
            <small className="field-hint">
              仅作用于 AINovel。1 点 = 10,000 计费 tokens；缓存输入、未缓存输入和输出分别乘以配置倍率。厂商 usage 优先，缺失时使用服务端估算。缓存倍率空白按未缓存输入计费；基础费率未配置时拒绝收费调用，0 表示明确免费。已有长上下文阶梯保留在费率版本中。
            </small>
            <Table<PricingRow>
              columns={columns}
              dataSource={rows}
              loading={loading}
              pagination={false}
              rowKey="key"
              scroll={{ x: 1060 }}
              size="small"
              expandable={{ expandedRowRender: (row) => <CreditContextTiersEditor
                modelKey={row.key} tiers={row.contextTiers ?? []}
                inputRate={row.inputPointsPerMillionTokens} outputRate={row.outputPointsPerMillionTokens}
                disabled={loading || !document?.isLatest}
                onChange={(contextTiers) => setRows((items) => items.map((item) => item.key === row.key ? { ...item, contextTiers } : item))} /> }}
            />
            <div className="button-row">
              <Button
                disabled={loading || invalidRates || !document?.isLatest || currentConfigJson === nextConfigJson}
                onClick={() => setSaveModalOpen(true)}
                type="primary"
              >保存费率</Button>
              <Button disabled={loading} onClick={() => void loadLatest()}>刷新最新</Button>
            </div>
          </div>
        </section>

        <RevisionHistoryDock
          expanded={historyExpanded}
          onToggle={() => setHistoryExpanded((current) => !current)}
          title="点数费率版本"
        >
          <RevisionList
            activeRevision={document?.revision}
            compact
            latestRevision={document?.revisions[0]?.revision}
            loadingRevision={restoringRevision}
            onRestore={(revision) => void requestRestore(revision)}
            onSelect={(revision) => void viewRevision(revision)}
            revisions={document?.revisions ?? []}
          />
        </RevisionHistoryDock>
      </div>

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：按新一版 OpenRouter 参考价更新费率"
        loading={saving}
        newValue={nextConfigJson}
        oldValue={currentConfigJson}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void confirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="确认调整 AINovel 模型点数费率"
      />
      <SaveConfirmModal
        desc={restoreDesc}
        loading={Boolean(restoreRevision) && restoringRevision === restoreRevision}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        onCancel={() => { setRestoreModalOpen(false); setRestoreRevision(null); }}
        onConfirm={() => void confirmRestore()}
        onDescChange={setRestoreDesc}
        open={restoreModalOpen}
        title={restoreRevision ? `确认恢复到版本 R${restoreRevision}` : "确认恢复"}
      />
    </>
  );
}
