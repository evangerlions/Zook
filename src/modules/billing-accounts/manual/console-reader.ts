import type { BalanceSample } from "../../llm-balances/balance-models.ts";
import { providerPages, type ManualProvider } from "./provider-pages.ts";
export interface ConsoleField { label: string; value: string; }
/** Exact labels only. Never turn an ambiguous page, percentage or missing field into a balance. */
export function readConsoleFields(provider: ManualProvider, fields: ConsoleField[]): BalanceSample {
  const spec = providerPages[provider];
  const candidates: { amount: number; unit: string }[] = [];
  for (const field of fields) {
    if (!spec.labels.includes(field.label.trim())) continue;
    const match = field.value.trim().match(/^([0-9]+(?:,[0-9]{3})*(?:\.[0-9]+)?)\s*(Credits|AFP|次|条|元|CNY)$/i);
    if (!match || !spec.units.some(unit => unit.toLowerCase() === match[2].toLowerCase())) continue;
    const amount = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(amount)) continue;
    const unit = match[2] === "元" ? "CNY" : spec.units.find(unit => unit.toLowerCase() === match[2].toLowerCase())!;
    candidates.push({ amount, unit });
  }
  // Two cards may represent different subscriptions/periods, even if the amounts happen to match.
  if (candidates.length !== 1) return { status: "error", metrics: [], detail: "Could not identify exactly one remaining balance. Open the account's subscription/usage page and retry. No value was saved." };
  const { amount, unit } = candidates[0];
  return { status: "ok", metrics: [{ kind: "manual_console_balance", scope: "account", remaining: amount, unit: unit as "Credits" | "CNY" | "AFP" | "次" | "条" }] };
}
