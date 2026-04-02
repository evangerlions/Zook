import { Button, Collapse, Input, Segmented, Select } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { RevisionHistoryDock } from "../components/revision-history-dock";
import { RevisionList } from "../components/revision-list";
import { Field, ToggleField } from "../components/field";
import { SaveConfirmModal } from "../components/save-confirm-modal";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import {
  cloneMailConfig,
  createDefaultMailConfig,
  createDefaultMailTestDraft,
  createEmptyMailTemplate,
  formatMailConfigJson,
  getMailDraftValidationError,
  MAIL_SENDER_REGION_OPTIONS,
  MAIL_TEMPLATE_LOCALE_OPTIONS,
  normalizeMailDocument,
  normalizeMailTestDraft,
  parseMailConfigText,
  renderMailRegionLabel,
  safeSerializeMailDraft,
  serializeMailDraft,
  serializeMailDraftForPreview,
  serializeMailTestDraft,
} from "../lib/mail-config";
import type {
  AdminEmailServiceDocument,
  AdminEmailTestSendDocument,
  MailConfigDraft,
  MailTestDraft,
} from "../lib/types";

const MAIL_TAB_OPTIONS: Array<{ label: string; value: "config" | "test" }> = [
  { label: "配置", value: "config" },
  { label: "测试发送", value: "test" },
];
const MAIL_CONFIG_MODE_OPTIONS: Array<{ label: string; value: "form" | "raw" }> = [
  { label: "表单", value: "form" },
  { label: "RAW JSON", value: "raw" },
];

export default function MailRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [tab, setTab] = useState<"config" | "test">("config");
  const [configMode, setConfigMode] = useState<"form" | "raw">("form");
  const [document, setDocument] = useState<AdminEmailServiceDocument | null>(null);
  const [draft, setDraft] = useState<MailConfigDraft>(createDefaultMailConfig());
  const [originalDraft, setOriginalDraft] = useState<MailConfigDraft>(createDefaultMailConfig());
  const [rawValue, setRawValue] = useState(() => formatMailConfigJson(createDefaultMailConfig()));
  const [testDraft, setTestDraft] = useState<MailTestDraft>(createDefaultMailTestDraft());
  const [testResult, setTestResult] = useState<AdminEmailTestSendDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restoringRevision, setRestoringRevision] = useState<number | null>(null);
  const [desc, setDesc] = useState("");
  const [historyExpanded, setHistoryExpanded] = useState(true);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const draftValidationError = useMemo(() => getMailDraftValidationError(draft), [draft]);
  const rawValidation = useMemo(() => {
    try {
      return {
        ...parseMailConfigText(rawValue),
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

  function applyConfigDocument(payload: AdminEmailServiceDocument | null) {
    const nextDraft = cloneMailConfig(payload?.config);
    setDocument(payload);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    setRawValue(formatMailConfigJson(payload?.config ?? nextDraft));
    setTestDraft((current) => normalizeMailTestDraft(current, nextDraft));
    setDesc("");
  }

  async function loadLatest() {
    setLoading(true);
    try {
      applyConfigDocument(normalizeMailDocument(await adminApi.getEmailService()));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadLatest();
  }, []);

  useEffect(() => {
    if (configMode !== "raw" || rawValidation.error || !rawValidation.draft || rawDraftSnapshot === draftSnapshot) {
      return;
    }

    setDraft(rawValidation.draft);
    setTestDraft((current) => normalizeMailTestDraft(current, rawValidation.draft!));
  }, [configMode, draftSnapshot, rawDraftSnapshot, rawValidation.draft, rawValidation.error]);

  useEffect(() => {
    if (configMode === "raw") {
      return;
    }

    setRawValue(formatMailConfigJson(draft));
  }, [configMode, draft]);

  const previewValue = useMemo(
    () => (configMode === "raw" ? rawValidation.config : serializeMailDraftForPreview(draft)),
    [configMode, draft, rawValidation.config],
  );

  function updateRegionSender(regionIndex: number, key: "id" | "address", value: string) {
    setDraft((current) => ({
      ...current,
      regions: current.regions.map((region, index) => {
        if (index !== regionIndex) {
          return region;
        }

        return {
          ...region,
          sender: {
            id: region.sender?.id ?? "",
            address: region.sender?.address ?? "",
            [key]: value,
          },
        };
      }),
    }));
  }

  function updateRegionTemplate(regionIndex: number, templateIndex: number, key: "locale" | "templateId" | "name" | "subject", value: string) {
    setDraft((current) => ({
      ...current,
      regions: current.regions.map((region, index) => {
        if (index !== regionIndex) {
          return region;
        }

        return {
          ...region,
          templates: region.templates.map((template, nextTemplateIndex) => (
            nextTemplateIndex === templateIndex ? { ...template, [key]: value } : template
          )),
        };
      }),
    }));
  }

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
      const nextConfig = configMode === "raw" ? parseMailConfigText(rawValue).config : serializeMailDraft(draft);
      const payload = normalizeMailDocument(
        await adminApi.updateEmailService({
          ...nextConfig,
          desc: desc.trim() || undefined,
        }),
      );
      applyConfigDocument(payload);
      setSaveModalOpen(false);
      setNotice(makeNotice("success", "邮件服务已保存。"));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSaving(false);
    }
  }

  async function handleViewRevision(revision: number) {
    setLoading(true);
    try {
      applyConfigDocument(normalizeMailDocument(await adminApi.getEmailServiceRevision(revision)));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setLoading(false);
    }
  }

  async function handleRestoreRevision(revision: number) {
    setRestoringRevision(revision);
    clearNotice();
    try {
      const payload = normalizeMailDocument(await adminApi.restoreEmailService(revision));
      applyConfigDocument(payload);
      setNotice(makeNotice("success", `已恢复到版本 R${revision}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setRestoringRevision(null);
    }
  }

  async function handleSendTest() {
    setTesting(true);
    clearNotice();
    setTestResult(null);
    try {
      const payload = await adminApi.sendEmailTest(serializeMailTestDraft(testDraft));
      setTestResult(payload);
      setNotice(makeNotice("success", `测试邮件已发送到 ${payload.recipientEmail}。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>邮件服务</h1>
          <p>管理公共邮件服务配置，支持固定结构配置、测试发送和历史版本回滚。</p>
        </div>
        <div className="top-actions">
          <span className="meta-chip">{document?.revision ? `R${document.revision}` : "未保存"}</span>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
          <span className="meta-chip">当前解析 Region: {renderMailRegionLabel(document?.resolvedRegion ?? "ap-guangzhou")}</span>
        </div>
      </header>

      <div className="tab-row">
        <Segmented
          className="page-segmented"
          onChange={(value) => setTab(value as "config" | "test")}
          options={MAIL_TAB_OPTIONS}
          value={tab}
        />
      </div>

      {tab === "config" ? (
        <div className="stack">
          <section className="surface-card collapse-card">
            <Collapse
              className="config-collapse"
              defaultActiveKey={[]}
              items={[
                {
                  key: "structure-preview",
                  label: "结构预览",
                  children: activeConfigError ? (
                    <div className="empty-state">当前配置还没有通过校验，暂时无法生成结构预览。</div>
                  ) : (
                    <JsonPreview value={previewValue} />
                  ),
                },
              ]}
            />
          </section>

          <div className={`page-grid page-grid--config${historyExpanded ? "" : " is-history-collapsed"}`}>
            <section className="surface-card">
              <div className="card-header">
                <div>
                  <h2>基础配置</h2>
                  <p>Region 固定为广州和香港，填写 sender 和模板后即可保存。</p>
                </div>
                <div className="top-actions">
                  {!document?.isLatest ? (
                    <Button onClick={() => void loadLatest()} size="large">
                      回到最新
                    </Button>
                  ) : null}
                  <Button onClick={() => void loadLatest()} size="large">
                    刷新
                  </Button>
                </div>
              </div>

              {loading ? <p className="meta-text">正在加载邮件配置...</p> : null}

              <div className="stack">
                <div className="config-mode-toolbar">
                  <Segmented
                    className="range-segmented"
                    onChange={(value) => setConfigMode(value as "form" | "raw")}
                    options={MAIL_CONFIG_MODE_OPTIONS}
                    value={configMode}
                  />
                  <span className="meta-chip">{activeConfigError ? "校验待修正" : "校验通过"}</span>
                </div>

                {configMode === "form" ? (
                  <>
                    <ToggleField
                      checked={draft.enabled}
                      hint="关闭后不会影响历史版本，但测试发送仍会校验当前草稿。"
                      label="启用邮件服务"
                      onChange={(value) => setDraft((current) => ({ ...current, enabled: value }))}
                    />

                    {draft.regions.map((region, regionIndex) => (
                      <article className="mail-region-card" key={region.region}>
                        <div className="card-header">
                          <div>
                            <h3>{renderMailRegionLabel(region.region)}</h3>
                            <p>为这个 Region 设置发件账号和模板映射。</p>
                          </div>
                          <span className="meta-chip">{region.region}</span>
                        </div>

                        <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                          <Field label="Sender ID">
                            <Input
                              onChange={(event) => updateRegionSender(regionIndex, "id", event.target.value)}
                              size="large"
                              value={region.sender?.id ?? ""}
                            />
                          </Field>
                          <Field label="Sender Address">
                            <Input
                              onChange={(event) => updateRegionSender(regionIndex, "address", event.target.value)}
                              placeholder="noreply@example.com"
                              size="large"
                              value={region.sender?.address ?? ""}
                            />
                          </Field>
                        </div>

                        <div className="template-list">
                          {region.templates.map((template, templateIndex) => (
                            <article className="route-card" key={`${region.region}-${templateIndex}`}>
                              <div className="form-grid" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}>
                                <Field label="Locale">
                                  <Select
                                    onChange={(value) => updateRegionTemplate(regionIndex, templateIndex, "locale", value)}
                                    options={MAIL_TEMPLATE_LOCALE_OPTIONS.map((item) => ({
                                      label: item.label,
                                      value: item.value,
                                    }))}
                                    optionFilterProp="label"
                                    showSearch
                                    size="large"
                                    value={template.locale}
                                  />
                                </Field>
                                <Field label="Template ID">
                                  <Input
                                    onChange={(event) => updateRegionTemplate(regionIndex, templateIndex, "templateId", event.target.value)}
                                    size="large"
                                    value={template.templateId}
                                  />
                                </Field>
                                <Field label="模板名称">
                                  <Input
                                    onChange={(event) => updateRegionTemplate(regionIndex, templateIndex, "name", event.target.value)}
                                    size="large"
                                    value={template.name}
                                  />
                                </Field>
                                <Field label="主题">
                                  <Input
                                    onChange={(event) => updateRegionTemplate(regionIndex, templateIndex, "subject", event.target.value)}
                                    size="large"
                                    value={template.subject}
                                  />
                                </Field>
                              </div>

                              <div className="button-row">
                                <Button
                                  danger
                                  onClick={() => {
                                    setDraft((current) => ({
                                      ...current,
                                      regions: current.regions.map((item, index) => (
                                        index === regionIndex
                                          ? { ...item, templates: item.templates.filter((_, indexValue) => indexValue !== templateIndex) }
                                          : item
                                      )),
                                    }));
                                  }}
                                >
                                  删除模板
                                </Button>
                              </div>
                            </article>
                          ))}

                          <Button
                            onClick={() => {
                              setDraft((current) => ({
                                ...current,
                                regions: current.regions.map((item, index) => (
                                  index === regionIndex
                                    ? { ...item, templates: [...item.templates, createEmptyMailTemplate()] }
                                    : item
                                )),
                              }));
                            }}
                          >
                            添加模板
                          </Button>
                        </div>
                      </article>
                    ))}

                    {draftValidationError ? <p className="form-error">{draftValidationError}</p> : null}
                  </>
                ) : (
                  <label className="field">
                    <span className="field-label">RAW JSON</span>
                    <JsonEditor
                      onChange={setRawValue}
                      readOnly={loading || saving}
                      value={rawValue}
                    />
                    <small className="field-hint">
                      直接编辑标准 JSON。`templateId` 请保持为 number，保存前会做 Region、模板名和模板 ID 的完整校验。
                    </small>
                    {rawValidation.error ? (
                      <small className="form-error">{rawValidation.error}</small>
                    ) : (
                      <small className="field-hint">保存前会按当前规则重新标准化，避免把结构写乱。</small>
                    )}
                  </label>
                )}

                <div className="button-row">
                  <Button disabled={saving || loading || Boolean(activeConfigError)} onClick={openSaveModal} size="large" type="primary">
                    保存邮件服务
                  </Button>
                </div>
              </div>
            </section>

            <RevisionHistoryDock
              expanded={historyExpanded}
              onToggle={() => setHistoryExpanded((current) => !current)}
            >
              <RevisionList
                activeRevision={document?.revision}
                compact
                loadingRevision={restoringRevision}
                onRestore={(revision) => void handleRestoreRevision(revision)}
                onSelect={(revision) => void handleViewRevision(revision)}
                revisions={document?.revisions ?? []}
              />
            </RevisionHistoryDock>
          </div>
        </div>
      ) : (
        <div className="page-grid">
          <section className="surface-card">
            <div className="card-header">
              <div>
                <h2>测试邮件</h2>
                <p>联调阶段建议先发到你自己的邮箱，确认 Region、模板和替换变量都正常。</p>
              </div>
            </div>

            <div className="stack">
              <div className="form-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <Field label="收件邮箱">
                  <Input
                    onChange={(event) => setTestDraft((current) => ({ ...current, recipientEmail: event.target.value }))}
                    size="large"
                    value={testDraft.recipientEmail}
                  />
                </Field>
                <Field label="App 名称">
                  <Input
                    onChange={(event) => setTestDraft((current) => ({ ...current, appName: event.target.value }))}
                    size="large"
                    value={testDraft.appName}
                  />
                </Field>
                <Field label="Region">
                  <Select
                    onChange={(value) => {
                      const nextRegion = value as MailTestDraft["region"];
                      setTestDraft((current) => normalizeMailTestDraft({ ...current, region: nextRegion }, draft));
                    }}
                    options={MAIL_SENDER_REGION_OPTIONS.map((item) => ({
                      label: item.label,
                      value: item.value,
                    }))}
                    size="large"
                    value={testDraft.region}
                  />
                </Field>
                <Field label="模板 ID">
                  <Select
                    onChange={(value) => setTestDraft((current) => ({ ...current, templateId: value }))}
                    options={[
                      { label: "请选择", value: "" },
                      ...(
                        draft.regions
                          .find((item) => item.region === testDraft.region)
                          ?.templates.map((item) => ({
                            label: `${item.name} / ${item.templateId}`,
                            value: String(item.templateId),
                          })) ?? []
                      ),
                    ]}
                    size="large"
                    value={testDraft.templateId}
                  />
                </Field>
                <Field label="验证码">
                  <Input
                    onChange={(event) => setTestDraft((current) => ({ ...current, code: event.target.value }))}
                    size="large"
                    value={testDraft.code}
                  />
                </Field>
                <Field label="过期分钟">
                  <Input
                    onChange={(event) => setTestDraft((current) => ({ ...current, expireMinutes: event.target.value }))}
                    size="large"
                    type="number"
                    value={String(testDraft.expireMinutes)}
                  />
                </Field>
              </div>

              <Button disabled={testing} loading={testing} onClick={() => void handleSendTest()} size="large" type="primary">
                {testing ? "发送中..." : "发送测试邮件"}
              </Button>
            </div>
          </section>

          <aside className="side-card">
            <div className="card-header">
              <div>
                <h2>最近结果</h2>
                <p>成功后会展示执行结果和调试信息。</p>
              </div>
            </div>
            {testResult ? (
              <JsonPreview value={testResult.debug ?? testResult} />
            ) : (
              <div className="empty-state">暂时还没有测试结果。</div>
            )}
          </aside>
        </div>
      )}

      <SaveConfirmModal
        desc={desc}
        descPlaceholder="例如：新增邮件模板或更新发件地址"
        loading={saving}
        newValue={configMode === "raw" ? rawValidation.normalizedText : JSON.stringify(safeSerializeMailDraft(draft), null, 2)}
        oldValue={JSON.stringify(safeSerializeMailDraft(originalDraft), null, 2)}
        onCancel={() => setSaveModalOpen(false)}
        onConfirm={() => void handleConfirmSave()}
        onDescChange={setDesc}
        open={saveModalOpen}
        title="保存邮件服务"
      />
    </section>
  );
}
