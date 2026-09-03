import type { AdminLlmSmokeTestDocument } from "./types";

export type LlmSmokeSummaryTone = "success" | "failed" | "neutral";

export interface LlmSmokeSummaryPresentation {
  scope: string;
  statusLabel: string;
  statusTone: LlmSmokeSummaryTone;
}

export function createLlmSmokeSummaryPresentation(
  document: AdminLlmSmokeTestDocument,
): LlmSmokeSummaryPresentation {
  const scope = document.target.mode === "route"
    ? `${document.target.modelKey} / ${document.target.provider}`
    : "全量矩阵";

  if (document.summary.failureCount > 0) {
    return { scope, statusLabel: "存在失败", statusTone: "failed" };
  }

  if (document.summary.successCount > 0) {
    return { scope, statusLabel: "运行正常", statusTone: "success" };
  }

  return { scope, statusLabel: "没有可执行路由", statusTone: "neutral" };
}
