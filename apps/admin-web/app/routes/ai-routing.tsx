import { Collapse } from "antd";
import { useEffect, useMemo, useState } from "react";

import { JsonEditor } from "../components/json-editor";
import { JsonPreview } from "../components/json-preview";
import { adminApi } from "../lib/admin-api";
import { useAdminSession } from "../lib/admin-session";
import { formatApiError, formatTimestamp, makeNotice } from "../lib/format";
import { safeParseJson } from "../lib/json";
import type { AdminAiRoutingDocument } from "../lib/types";

const AI_NOVEL_APP_ID = "ai_novel";

export default function AiRoutingRoute() {
  const {
    apps,
    selectedAppId,
    setNotice,
    completeWorkspaceTransition,
  } = useAdminSession();

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID) ?? null;
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  const [document, setDocument] = useState<AdminAiRoutingDocument | null>(null);
  const [value, setValue] = useState("");
  const previewValue = useMemo(() => safeParseJson(value), [value]);

  async function loadLatest() {
    if (selectedAppId !== AI_NOVEL_APP_ID) {
      setDocument(null);
      setValue("");
      completeWorkspaceTransition();
      return;
    }

    try {
      const payload = await adminApi.getAiRouting(AI_NOVEL_APP_ID);
      setDocument(payload);
      setValue(payload.rawJson);
    } catch (error) {
      setNotice(makeNotice("error", formatApiError(error)));
    } finally {
      completeWorkspaceTransition();
    }
  }

  useEffect(() => {
    void loadLatest();
  }, [selectedAppId]);

  if (!aiNovelApp) {
    return (
      <section className="empty-state">
        当前工作区中还没有 `ai_novel` 项目，暂时无法查看 AI Routing。
      </section>
    );
  }

  if (selectedApp?.appId !== AI_NOVEL_APP_ID) {
    return (
      <section className="empty-state">
        AI Routing 目前只支持 `ai_novel`。请先在项目空间切换到 `ai_novel` 再查看。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>AI Routing</h1>
          <p>这里展示 Zook 代码硬编码的 AINovel scene 路由表；运行时不再读取 admin 配置。</p>
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
              children: <JsonPreview value={previewValue} />,
            },
          ]}
        />
      </section>

      <div className="page-grid page-grid--config is-history-collapsed">
        <section className="editor-card">
          <div className="card-header">
            <div>
              <h2>{aiNovelApp.appName}</h2>
              <p className="mono">{AI_NOVEL_APP_ID}</p>
            </div>
            <div className="top-actions">
              <span className="meta-chip">
                {document?.desc ?? "hardcoded"}
              </span>
              <span className="meta-chip">{formatTimestamp(document?.updatedAt)}</span>
            </div>
          </div>

          <div className="stack">
            <label className="field">
              <span className="field-label">JSON 配置</span>
              <JsonEditor
                onChange={setValue}
                readOnly
                value={value}
              />
              <small className="field-hint">当前路由表由后端代码硬编码；如需调整，请修改 Zook 源码中的默认路由。</small>
            </label>
          </div>
        </section>
      </div>
    </section>
  );
}
