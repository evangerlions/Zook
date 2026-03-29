import { Button, Collapse, Input, Popconfirm } from "antd";
import { useEffect, useState } from "react";

import { JsonPreview } from "../components/json-preview";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import {
  createEmptyPasswordItem,
  clonePasswordConfig,
  normalizePasswordDocument,
  serializePasswordDraftForPreview,
  serializePasswordItem,
} from "../lib/password-config";
import type { AdminPasswordDocument, PasswordDraftItem } from "../lib/types";

export default function PasswordsRoute() {
  const { clearNotice, setNotice } = useAdminSession();
  const [document, setDocument] = useState<AdminPasswordDocument | null>(null);
  const [draft, setDraft] = useState<PasswordDraftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [savingIndex, setSavingIndex] = useState<number | null>(null);
  const [deletingIndex, setDeletingIndex] = useState<number | null>(null);

  async function loadPasswords() {
    setLoading(true);
    try {
      const payload = await adminApi.getPasswords();
      const normalized = normalizePasswordDocument(payload);
      setDocument(normalized);
      setDraft(clonePasswordConfig(normalized?.items));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadPasswords();
  }, []);

  function updateItem(index: number, key: keyof PasswordDraftItem, value: string) {
    setDraft((current) => current.map((item, itemIndex) => (
      itemIndex === index ? { ...item, [key]: value } : item
    )));
  }

  async function handleSaveItem(index: number) {
    const item = draft[index];
    if (!item) {
      return;
    }

    setSavingIndex(index);
    clearNotice();
    try {
      const payload = await adminApi.upsertPasswordItem(serializePasswordItem(item, index));
      const normalized = normalizePasswordDocument(payload);
      setDocument(normalized);
      setDraft(clonePasswordConfig(normalized?.items));
      setNotice(makeNotice("success", `${item.key} 已保存。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setSavingIndex(null);
    }
  }

  async function handleDeleteItem(index: number) {
    const item = draft[index];
    if (!item?.key) {
      setDraft((current) => current.filter((_, itemIndex) => itemIndex !== index));
      return;
    }

    setDeletingIndex(index);
    clearNotice();
    try {
      const payload = await adminApi.deletePasswordItem(item.key);
      const normalized = normalizePasswordDocument(payload);
      setDocument(normalized);
      setDraft(clonePasswordConfig(normalized?.items));
      setNotice(makeNotice("success", `${item.key} 已删除。`));
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      setDeletingIndex(null);
    }
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>PASSWORDS</h1>
          <p>管理 `common.passwords` 中的公共机密项，支持逐条保存和删除。</p>
        </div>
        <div className="top-actions">
          <Button
            onClick={() => setDraft((current) => [...current, createEmptyPasswordItem()])}
            type="default"
          >
            添加密码项
          </Button>
          <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
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
              children: <JsonPreview value={serializePasswordDraftForPreview(draft)} />,
            },
          ]}
        />
      </section>

      <section className="surface-card">
        <div className="card-header">
          <div>
            <h2>密码条目</h2>
            <p>空白条目不会参与保存。每条记录独立提交，便于逐项联调。</p>
          </div>
        </div>

        {loading ? <p className="meta-text">正在加载密码配置...</p> : null}

        <div className="password-list">
          {draft.length ? draft.map((item, index) => (
            <article className="password-item" key={`${item.originalKey || "draft"}-${index}`}>
              <div className="stack" style={{ width: "100%" }}>
                <div className="form-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                  <label className="field">
                    <span className="field-label">Key</span>
                    <Input onChange={(event) => updateItem(index, "key", event.target.value)} size="large" value={item.key} />
                  </label>

                  <label className="field">
                    <span className="field-label">描述</span>
                    <Input onChange={(event) => updateItem(index, "desc", event.target.value)} size="large" value={item.desc} />
                  </label>

                  <label className="field">
                    <span className="field-label">值</span>
                    <Input
                      autoComplete="off"
                      onChange={(event) => updateItem(index, "value", event.target.value)}
                      size="large"
                      value={item.value}
                    />
                  </label>
                </div>

                <div className="inline-row">
                  <span className="meta-chip">{item.valueMd5 ? `MD5 ${item.valueMd5}` : "MD5 待生成"}</span>
                  <span className="meta-chip">{formatTimestamp(item.updatedAt)}</span>
                </div>
              </div>

              <div className="button-row">
                <Button
                  disabled={savingIndex === index}
                  loading={savingIndex === index}
                  onClick={() => void handleSaveItem(index)}
                  type="primary"
                >
                  {item.originalKey ? "保存" : "添加"}
                </Button>
                <Popconfirm
                  cancelText="取消"
                  okText="删除"
                  onConfirm={() => void handleDeleteItem(index)}
                  title={item.key ? `确认删除 ${item.key}？` : "确认删除这个草稿项？"}
                >
                  <Button danger disabled={deletingIndex === index} loading={deletingIndex === index} type="primary">
                    删除
                  </Button>
                </Popconfirm>
              </div>
            </article>
          )) : (
            <div className="empty-state">当前还没有密码项，可以先新增一条。</div>
          )}
        </div>
      </section>
    </section>
  );
}
