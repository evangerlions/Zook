import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Input, InputNumber, Segmented, Switch, Table, Tag } from "antd";
import { useMemo, useState } from "react";

import { ContentSafetyBlockRecordsTab } from "../components/content-safety-block-records-tab";
import { ContentSafetyProvidersTab } from "../components/content-safety-providers-tab";
import { ContentSafetyStatsTab } from "../components/content-safety-stats-tab";
import { ContentSafetyTestTab } from "../components/content-safety-test-tab";
import { Field, ToggleField } from "../components/field";
import { JsonPreview } from "../components/json-preview";
import { MetricCard } from "../components/metric-card";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { SensitiveOperationModal } from "../components/sensitive-operation-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import type {
  AdminContentSafetyDocument,
  AdminPasswordDocument,
  ContentSafetyConfig,
  ContentSafetyKeywordRule,
} from "../lib/types";

type ContentSafetyTab = "strategy" | "keywords" | "providers" | "test" | "blockRecords" | "stats";

const CONTENT_SAFETY_OPERATION = "content_safety.sensitive_words.manage";
const CONTENT_SAFETY_TABS: Array<{ label: string; value: ContentSafetyTab }> = [
  { label: "策略", value: "strategy" },
  { label: "敏感词", value: "keywords" },
  { label: "模型/API", value: "providers" },
  { label: "测试", value: "test" },
  { label: "拦截记录", value: "blockRecords" },
  { label: "数据统计", value: "stats" },
];

function createDefaultConfig(): ContentSafetyConfig {
  return {
    enabled: false,
    longTextThresholdChars: 2000,
    keyword: {
      enabled: true,
      rules: [],
    },
    llm: {
      enabled: true,
      modelKey: "qwen3.5-flash",
      timeoutMs: 5000,
    },
    aliyun: {
      enabled: false,
      endpoint: "https://green-cip.cn-shanghai.aliyuncs.com",
      region: "cn-shanghai",
      service: "chat_detection",
      accessKeyIdPasswordKey: "",
      accessKeySecretPasswordKey: "",
      timeoutMs: 5000,
    },
  };
}

function cloneConfig(config?: ContentSafetyConfig | null): ContentSafetyConfig {
  return JSON.parse(JSON.stringify(config ?? createDefaultConfig())) as ContentSafetyConfig;
}

function formatConfigJson(config: ContentSafetyConfig): string {
  return JSON.stringify(config, null, 2);
}

function updateRule(
  config: ContentSafetyConfig,
  index: number,
  patch: Partial<ContentSafetyKeywordRule>,
): ContentSafetyConfig {
  return {
    ...config,
    keyword: {
      ...config.keyword,
      rules: config.keyword.rules.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    },
  };
}

export default function ContentSafetyRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [authorized, setAuthorized] = useState(false);
  const [authOpen, setAuthOpen] = useState(true);
  const [document, setDocument] = useState<AdminContentSafetyDocument | null>(null);
  const [passwords, setPasswords] = useState<AdminPasswordDocument | null>(null);
  const [draft, setDraft] = useState<ContentSafetyConfig>(createDefaultConfig());
  const [originalDraft, setOriginalDraft] = useState<ContentSafetyConfig>(createDefaultConfig());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [desc, setDesc] = useState("");
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [restoreModalOpen, setRestoreModalOpen] = useState(false);
  const [restoreRevision, setRestoreRevision] = useState<number | null>(null);
  const [restoreDesc, setRestoreDesc] = useState("");
  const [restoreOldValue, setRestoreOldValue] = useState("");
  const [restoreNewValue, setRestoreNewValue] = useState("");
  const [tab, setTab] = useState<ContentSafetyTab>("strategy");
  const passwordOptions = useMemo(
    () => (passwords?.items ?? []).map((item) => ({
      label: `${item.key}${item.desc ? ` · ${item.desc}` : ""}`,
      value: item.key,
    })),
    [passwords],
  );

  function applyDocument(payload: AdminContentSafetyDocument | null) {
    const nextDraft = cloneConfig(payload?.config);
    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setDesc("");
  }

  async function loadLatest() {
    setLoading(true);
    try {
      const [configPayload, passwordPayload] = await Promise.all([
        adminApi.getContentSafety(),
        adminApi.getPasswords(),
      ]);
      applyDocument(configPayload);
      setPasswords(passwordPayload);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleAuthorized() {
    setAuthorized(true);
    setAuthOpen(false);
    await loadLatest();
  }

  function addRule() {
    const id = `kw_${Date.now().toString(36)}`;
    setDraft((current) => ({
      ...current,
      keyword: {
        ...current.keyword,
        rules: [
          ...current.keyword.rules,
          {
            id,
            term: "",
            category: "",
            note: "",
            enabled: true,
          },
        ],
      },
    }));
  }

  function removeRule(index: number) {
    setDraft((current) => ({
      ...current,
      keyword: {
        ...current.keyword,
        rules: current.keyword.rules.filter((_, itemIndex) => itemIndex !== index),
      },
    }));
  }

  async function handleConfirmSave() {
    setSaving(true);
    clearNotice();
    try {
      const payload = await adminApi.updateContentSafety({
        ...draft,
        desc: desc.trim() || undefined,
      });
      applyDocument(payload);
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "内容安全配置已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      applyDocument(await adminApi.getContentSafetyRevision(revision));
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
        adminApi.getContentSafety(),
        adminApi.getContentSafetyRevision(revision),
      ]);
      setRestoreRevision(revision);
      setRestoreOldValue(formatConfigJson(latestPayload.config));
      setRestoreNewValue(formatConfigJson(revisionPayload.config));
      setRestoreDesc(`恢复内容安全配置到 R${revision}`);
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
      applyDocument(await adminApi.restoreContentSafety(restoreRevision, restoreDesc.trim()));
      setRestoreModalOpen(false);
      setNotice(makeNotice("success", `已恢复到 R${restoreRevision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  const latestRevision = document?.revisions[0]?.revision;

  return (
    <section className="stack">
      <SensitiveOperationModal
        description="内容安全页包含敏感词策略，进入前需要完成二级密码验证。"
        onAuthorized={() => handleAuthorized()}
        onClose={() => setAuthOpen(false)}
        open={authOpen && !authorized}
        operation={CONTENT_SAFETY_OPERATION}
        title="验证后进入内容安全配置"
      />

      <header className="page-header">
        <div>
          <h1>内容安全</h1>
          <p>配置用户输入审核链路：敏感词、qwen3.5-flash 和长文本阿里云内容安全。</p>
        </div>
        <div className="top-actions">
          <Button disabled={!authorized || loading} onClick={() => void loadLatest()}>
            刷新
          </Button>
          <Button disabled={!authorized} loading={saving} onClick={() => setSaveModalOpen(true)} type="primary">
            保存配置
          </Button>
        </div>
      </header>

      {!authorized ? (
        <section className="surface-card">
          <h2>需要二级密码验证</h2>
          <p>验证完成前不会加载敏感词与审核配置。</p>
          <Button onClick={() => setAuthOpen(true)} type="primary">验证进入</Button>
        </section>
      ) : (
        <div className="page-grid page-grid--config">
          <main className="surface-card stack">
            <div className="card-header">
              <div>
                <h2>审核策略</h2>
                <p>
                  当前版本 {document?.revision ? `R${document.revision}` : "未保存"}
                  {document?.updatedAt ? ` · ${formatTimestamp(document.updatedAt)}` : ""}
                </p>
              </div>
              <Tag color={draft.enabled ? "green" : "default"}>{draft.enabled ? "已启用" : "未启用"}</Tag>
            </div>

            <div className="tab-row">
              <Segmented
                className="page-segmented"
                onChange={(value) => setTab(value as ContentSafetyTab)}
                options={CONTENT_SAFETY_TABS}
                value={tab}
              />
            </div>

            {tab === "strategy" ? (
              <>
                <section className="content-safety-section">
                  <div className="section-heading">
                    <div>
                      <h3>策略总览</h3>
                      <p>先用关键词快速拦截，短文本走 LLM，长文本切到传统内容安全 API。</p>
                    </div>
                  </div>
                  <div className="content-safety-basic-grid">
                    <ToggleField
                      checked={draft.enabled}
                      hint="关闭后仅保留配置，不拦截用户输入。"
                      label="启用内容安全"
                      onChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                    />
                    <Field label="长文本阈值" hint="超过该长度后切到阿里云内容安全。">
                      <InputNumber
                        min={1}
                        onChange={(value) => setDraft((current) => ({
                          ...current,
                          longTextThresholdChars: Number(value ?? 2000),
                        }))}
                        value={draft.longTextThresholdChars}
                      />
                    </Field>
                  </div>
                </section>

                <div className="metric-grid">
                  <MetricCard
                    hint={`共 ${draft.keyword.rules.length} 条规则`}
                    label="关键词层"
                    value={draft.keyword.enabled ? "已启用" : "未启用"}
                  />
                  <MetricCard
                    hint={draft.llm.modelKey || "未配置"}
                    label="模型层"
                    value={draft.llm.enabled ? "已启用" : "未启用"}
                  />
                  <MetricCard
                    hint={draft.aliyun.service || "未配置"}
                    label="传统 API"
                    value={draft.aliyun.enabled ? "已启用" : "未启用"}
                  />
                </div>

                <JsonPreview value={draft} />
              </>
            ) : null}

            {tab === "keywords" ? (
              <section className="content-safety-section">
                <div className="section-heading">
                  <div>
                    <h3>敏感词</h3>
                    <p>命中后直接拒绝，不会进入 LLM 审核。</p>
                  </div>
                  <div className="section-actions">
                    <Switch
                      checked={draft.keyword.enabled}
                      onChange={(enabled) => setDraft((current) => ({
                        ...current,
                        keyword: { ...current.keyword, enabled },
                      }))}
                    />
                    <Button icon={<PlusOutlined />} onClick={addRule}>添加敏感词</Button>
                  </div>
                </div>
                <Table
                  className="content-safety-keyword-table"
                  columns={[
                    {
                      title: "启用",
                      width: 80,
                      render: (_value, _item, index) => (
                        <Switch
                          checked={draft.keyword.rules[index]?.enabled ?? false}
                          onChange={(enabled) => setDraft((current) => updateRule(current, index, { enabled }))}
                        />
                      ),
                    },
                    {
                      title: "词条",
                      width: 280,
                      render: (_value, _item, index) => (
                        <Input
                          onChange={(event) => setDraft((current) => updateRule(current, index, {
                            term: event.target.value,
                          }))}
                          placeholder="输入敏感词"
                          value={draft.keyword.rules[index]?.term}
                        />
                      ),
                    },
                    {
                      title: "分类",
                      width: 180,
                      render: (_value, _item, index) => (
                        <Input
                          onChange={(event) => setDraft((current) => updateRule(current, index, {
                            category: event.target.value,
                          }))}
                          placeholder="可选"
                          value={draft.keyword.rules[index]?.category}
                        />
                      ),
                    },
                    {
                      title: "备注",
                      render: (_value, _item, index) => (
                        <Input
                          onChange={(event) => setDraft((current) => updateRule(current, index, {
                            note: event.target.value,
                          }))}
                          placeholder="可选"
                          value={draft.keyword.rules[index]?.note}
                        />
                      ),
                    },
                    {
                      title: "",
                      width: 72,
                      render: (_value, _item, index) => (
                        <Button danger icon={<DeleteOutlined />} onClick={() => removeRule(index)} shape="circle" />
                      ),
                    },
                  ]}
                  dataSource={draft.keyword.rules}
                  loading={loading}
                  pagination={false}
                  rowKey={(item) => item.id}
                  scroll={{ x: 900 }}
                />
              </section>
            ) : null}

            {tab === "providers" ? (
              <ContentSafetyProvidersTab
                draft={draft}
                onDraftChange={setDraft}
                passwordOptions={passwordOptions}
              />
            ) : null}

            {tab === "test" ? <ContentSafetyTestTab /> : null}

            {tab === "blockRecords" ? <ContentSafetyBlockRecordsTab /> : null}

            {tab === "stats" ? <ContentSafetyStatsTab /> : null}
          </main>

          <RevisionHistoryDock expanded={historyExpanded} onToggle={() => setHistoryExpanded((value) => !value)}>
            <RevisionList
              activeRevision={document?.revision}
              latestRevision={latestRevision}
              loadingRevision={restoringRevision}
              onRestore={handleRequestRestoreRevision}
              onSelect={handleViewRevision}
              revisions={document?.revisions ?? []}
            />
          </RevisionHistoryDock>
        </div>
      )}

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：新增通用敏感词规则"
        loading={saving}
        newValue={formatConfigJson(draft)}
        oldValue={formatConfigJson(originalDraft)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存内容安全配置"
      />
      <SaveConfirmModal
        desc={restoreDesc}
        loading={restoringRevision !== null}
        newValue={restoreNewValue}
        oldValue={restoreOldValue}
        okText="确认恢复"
        onCancel={() => setRestoreModalOpen(false)}
        onConfirm={() => void handleConfirmRestore()}
        onDescChange={setRestoreDesc}
        open={restoreModalOpen}
        title={`恢复到版本 R${restoreRevision ?? ""}`}
      />
    </section>
  );
}
