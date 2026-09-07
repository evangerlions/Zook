import { useEffect } from "react";

import { AiNovelModelSelectionPanel } from "../components/ai-novel-model-selection-panel";
import { useAdminSession } from "../lib/admin-session";

const AI_NOVEL_APP_ID = "ai_novel";

export default function AiRoutingRoute() {
  const {
    apps,
    selectedAppId,
    completeWorkspaceTransition,
  } = useAdminSession();

  const aiNovelApp = apps.find((item) => item.appId === AI_NOVEL_APP_ID) ?? null;
  const selectedApp = apps.find((item) => item.appId === selectedAppId) ?? null;
  useEffect(() => {
    completeWorkspaceTransition();
  }, [selectedAppId]);

  if (!aiNovelApp) {
    return (
      <section className="empty-state">
        当前工作区中还没有 `ai_novel` 项目，暂时无法配置 AI Model。
      </section>
    );
  }

  if (selectedApp?.appId !== AI_NOVEL_APP_ID) {
    return (
      <section className="empty-state">
        AI Model 目前只支持 `ai_novel`。请先在项目空间切换到 `ai_novel` 再查看。
      </section>
    );
  }

  return (
    <section className="stack">
      <header className="page-header">
        <div>
          <h1>AI Model</h1>
          <p>配置 AINovel 所有文本生成任务共用的模型权重。</p>
        </div>
      </header>

      <AiNovelModelSelectionPanel />
    </section>
  );
}
