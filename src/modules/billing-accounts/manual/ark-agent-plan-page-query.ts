import { arkQuotaWindows } from "../ark-agent-plan-quota.ts";
import type { Page } from "playwright";
import { ApplicationError } from "../../../shared/errors.ts";
import type { BalanceMetric, BalanceSample } from "../../llm-balances/balance-models.ts";
import { isBalancePage } from "./provider-pages.ts";

export async function readArkAgentPlanQuota(page: Page): Promise<BalanceSample> {
  if (!isBalancePage("agent-plan", page.url())) {
    throw new ApplicationError(409, "REQ_INVALID_BODY", "请先打开火山方舟 Agent Plan 个人版订阅页。");
  }

  const metrics: BalanceMetric[] = [];
  for (const { name, kind } of arkQuotaWindows) {
    const used = await page.getByRole("progressbar", { name, exact: true }).evaluateAll(bars => {
      if (bars.length !== 1) return null;
      const [bar] = bars;
      const value = bar.getAttribute("aria-valuenow")?.trim();
      if (value) {
        const min = bar.getAttribute("aria-valuemin") ?? "0";
        const max = bar.getAttribute("aria-valuemax") ?? "100";
        if (Number(min) !== 0 || Number(max) !== 100) return null;
        return Number(value);
      }
      const display = bar.getAttribute("aria-valuetext")?.trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*%$/);
      if (display) return Number(display[1]);
      if (bar instanceof HTMLProgressElement) {
        const nativeValue = bar.getAttribute("value")?.trim();
        if (nativeValue) return (Number(nativeValue) / bar.max) * 100;
      }
      return null;
    });

    if (used === null || !Number.isFinite(used) || used < 0 || used > 100) {
      return { status: "error", metrics: [], detail: "未能读取完整的 Agent Plan 额度。请等待订阅页加载完成后重试。" };
    }
    metrics.push({ kind, scope: "personal", remaining: 100 - used, unit: "%" });
  }

  if (!isBalancePage("agent-plan", page.url())) {
    return { status: "error", metrics: [], detail: "Agent Plan 订阅页已离开，请重新打开后重试。" };
  }
  return { status: "ok", metrics };
}
