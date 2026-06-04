import { Input, InputNumber, Select, Switch } from "antd";
import type { Dispatch, SetStateAction } from "react";

import { Field } from "./field";
import type { ContentSafetyConfig } from "../lib/types";

interface ContentSafetyProvidersTabProps {
  draft: ContentSafetyConfig;
  onDraftChange: Dispatch<SetStateAction<ContentSafetyConfig>>;
  passwordOptions: Array<{ label: string; value: string }>;
}

export function ContentSafetyProvidersTab({
  draft,
  onDraftChange,
  passwordOptions,
}: ContentSafetyProvidersTabProps) {
  return (
    <>
      <section className="content-safety-section">
        <div className="section-heading">
          <div>
            <h3>qwen3.5-flash 审核</h3>
            <p>短文本走低成本 LLM 审核，这里填写厂商原始模型名。</p>
          </div>
          <Switch
            checked={draft.llm.enabled}
            onChange={(enabled) => onDraftChange((current) => ({
              ...current,
              llm: { ...current.llm, enabled },
            }))}
          />
        </div>
        <div className="content-safety-provider-grid">
          <Field label="Model Key">
            <Input
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                llm: { ...current.llm, modelKey: event.target.value },
              }))}
              value={draft.llm.modelKey}
            />
          </Field>
          <Field label="超时时间 ms">
            <InputNumber
              min={1}
              onChange={(value) => onDraftChange((current) => ({
                ...current,
                llm: { ...current.llm, timeoutMs: Number(value ?? 5000) },
              }))}
              value={draft.llm.timeoutMs}
            />
          </Field>
        </div>
      </section>

      <section className="content-safety-section">
        <div className="section-heading">
          <div>
            <h3>阿里云内容安全</h3>
            <p>凭据只保存 PASSWORD key 引用，不在本页保存明文。</p>
          </div>
          <Switch
            checked={draft.aliyun.enabled}
            onChange={(enabled) => onDraftChange((current) => ({
              ...current,
              aliyun: { ...current.aliyun, enabled },
            }))}
          />
        </div>
        <div className="content-safety-provider-grid">
          <Field label="Endpoint">
            <Input
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, endpoint: event.target.value },
              }))}
              value={draft.aliyun.endpoint}
            />
          </Field>
          <Field label="Region">
            <Input
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, region: event.target.value },
              }))}
              value={draft.aliyun.region}
            />
          </Field>
          <Field label="Service">
            <Input
              onChange={(event) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, service: event.target.value },
              }))}
              value={draft.aliyun.service}
            />
          </Field>
          <Field label="超时时间 ms">
            <InputNumber
              min={1}
              onChange={(value) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, timeoutMs: Number(value ?? 5000) },
              }))}
              value={draft.aliyun.timeoutMs}
            />
          </Field>
          <Field label="AccessKeyId Password Key">
            <Select
              allowClear
              onChange={(value) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, accessKeyIdPasswordKey: value ?? "" },
              }))}
              options={passwordOptions}
              placeholder="选择 PASSWORD key"
              showSearch
              value={draft.aliyun.accessKeyIdPasswordKey || undefined}
            />
          </Field>
          <Field label="AccessKeySecret Password Key">
            <Select
              allowClear
              onChange={(value) => onDraftChange((current) => ({
                ...current,
                aliyun: { ...current.aliyun, accessKeySecretPasswordKey: value ?? "" },
              }))}
              options={passwordOptions}
              placeholder="选择 PASSWORD key"
              showSearch
              value={draft.aliyun.accessKeySecretPasswordKey || undefined}
            />
          </Field>
        </div>
      </section>
    </>
  );
}
