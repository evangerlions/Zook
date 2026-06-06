import { Button, Input, Select } from "antd";

import { Field } from "./field";
import { JsonPreview } from "./json-preview";
import {
  MAIL_SENDER_REGION_OPTIONS,
  normalizeMailTestDraft,
} from "../lib/mail-config";
import type {
  AdminEmailTestSendDocument,
  MailConfigDraft,
  MailTestDraft,
} from "../lib/types";

interface MailTestSectionProps {
  draft: MailConfigDraft;
  onSend: () => void;
  onTestDraftChange: (updater: (current: MailTestDraft) => MailTestDraft) => void;
  testDraft: MailTestDraft;
  testing: boolean;
  testResult: AdminEmailTestSendDocument | null;
}

export function MailTestSection({
  draft,
  onSend,
  onTestDraftChange,
  testDraft,
  testing,
  testResult,
}: MailTestSectionProps) {
  return (
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
                onChange={(event) => onTestDraftChange((current) => ({
                  ...current,
                  recipientEmail: event.target.value,
                }))}
                size="large"
                value={testDraft.recipientEmail}
              />
            </Field>
            <Field label="App 名称">
              <Input
                onChange={(event) => onTestDraftChange((current) => ({
                  ...current,
                  appName: event.target.value,
                }))}
                size="large"
                value={testDraft.appName}
              />
            </Field>
            <Field label="Region">
              <Select
                onChange={(value) => {
                  const nextRegion = value as MailTestDraft["region"];
                  onTestDraftChange((current) => normalizeMailTestDraft({
                    ...current,
                    region: nextRegion,
                  }, draft));
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
                onChange={(value) => onTestDraftChange((current) => ({
                  ...current,
                  templateId: value,
                }))}
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
                onChange={(event) => onTestDraftChange((current) => ({
                  ...current,
                  code: event.target.value,
                }))}
                size="large"
                value={testDraft.code}
              />
            </Field>
            <Field label="过期分钟">
              <Input
                onChange={(event) => onTestDraftChange((current) => ({
                  ...current,
                  expireMinutes: event.target.value,
                }))}
                size="large"
                type="number"
                value={String(testDraft.expireMinutes)}
              />
            </Field>
          </div>

          <Button disabled={testing} loading={testing} onClick={onSend} size="large" type="primary">
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
  );
}
