import type { AdminLlmSmokeTestDocument, AdminLlmSmokeTestItem } from "./types";

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

export function sortLlmSmokeItems(
  items: readonly AdminLlmSmokeTestItem[],
): AdminLlmSmokeTestItem[] {
  const collator = new Intl.Collator("zh-CN", { numeric: true, sensitivity: "base" });
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) =>
      compareSmokeText(left.item.providerLabel || left.item.provider, right.item.providerLabel || right.item.provider, collator) ||
      compareSmokeText(left.item.modelLabel || left.item.modelKey, right.item.modelLabel || right.item.modelKey, collator) ||
      compareSmokeText(left.item.providerModel, right.item.providerModel, collator) ||
      left.index - right.index,
    )
    .map(({ item }) => item);
}

function compareSmokeText(left: string | undefined, right: string | undefined, collator: Intl.Collator): number {
  return collator.compare(left ?? "", right ?? "");
}
