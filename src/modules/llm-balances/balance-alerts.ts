import { createHash } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { FeishuClient } from "../feishu/feishu-client.ts";
import type { IntegrationReceipt, IntegrationReceipts } from "../feishu/integration-receipts.ts";
import type { BalanceConfig, BalanceRule, BalanceSnapshot } from "./balance-models.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";

type Level = "healthy" | "warning" | "critical";
interface AlertEvent { id: string; kind: "balance" | "query_failed" | "query_recovered"; level: Level; text: string; }
interface AlertState { level: Level; sentAt?: number; queryFailed: boolean; pending?: AlertEvent; delivery?: IntegrationReceipt["status"]; }

function eventFor(sample: BalanceSnapshot, rule: BalanceRule, config: BalanceConfig, state: AlertState, now: Date): AlertEvent | undefined {
  const prefix = `[Zook Balance] Provider: ${sample.provider} | Account: ${sample.accountId}`;
  const event = (kind: AlertEvent["kind"], level: Level, message: string): AlertEvent => ({
    id: createHash("sha256").update(`${sample.accountId}:${now.getTime()}:${kind}`).digest("hex"), kind, level,
    text: `${prefix}\n${message}\nChecked at: ${sample.checkedAt ?? now.toISOString()}`,
  });
  if (sample.status !== "ok") {
    if (sample.failures >= config.failureCount && !state.queryFailed) {
      return event("query_failed", state.level, `Balance query failed ${sample.failures} consecutive times. Status: ${sample.status}. Last successful check: ${sample.lastSuccessAt ?? "never"}. Please check the provider credentials and permissions.`);
    }
    return;
  }
  if (state.queryFailed && sample.successfulSamples >= config.recoverySamples) return event("query_recovered", state.level, "Balance queries have recovered.");
  const balance = sample.metrics.find(item => item.scope !== "key" && item.remaining !== null);
  if (!balance || balance.remaining === null) return;
  const level: Level = balance.remaining < rule.critical ? "critical" : balance.remaining < rule.warning ? "warning" : "healthy";
  if (level === "healthy") {
    if (state.level !== "healthy" && sample.safeSamples >= config.recoverySamples) return event("balance", level, `Balance recovered: ${balance.remaining} ${balance.unit}. Warning threshold: ${rule.warning} ${balance.unit}.`);
    return;
  }
  const interval = (level === "critical" ? config.criticalRepeatHours : config.warningRepeatHours) * 3600_000;
  if (state.level === level && now.getTime() - (state.sentAt ?? 0) < interval) return;
  return event("balance", level, `${level === "critical" ? "CRITICAL: Very low balance" : "WARNING: Low balance"}: ${balance.remaining} ${balance.unit}.\nWarning threshold: ${rule.warning} ${balance.unit}; critical threshold: ${rule.critical} ${balance.unit}. Please review the account and top up if needed.`);
}

export class BalanceAlerts {
  constructor(private readonly kv: KVManager, private readonly sender: FeishuClient, private readonly receipts: IntegrationReceipts,
    private readonly logger?: StructuredLogger) {}

  async evaluate(sample: BalanceSnapshot, rule: BalanceRule, config: BalanceConfig, now: Date): Promise<void> {
    if (!rule.alerts) return;
    const state = await this.kv.getJson<AlertState>("llm-balance-alert", sample.accountId) ?? { level: "healthy", queryFailed: false };
    if (!state.pending) {
      const next = eventFor(sample, rule, config, state, now);
      if (!next) return;
      state.pending = next;
      // Persist the event before the external mutation; crash recovery reuses the exact same receipt.
      await this.kv.setJson("llm-balance-alert", sample.accountId, state);
    }
    if (!await this.sender.ready()) return;
    const pending = state.pending;
    const receipt = await this.receipts.execute("balance-worker", "messages:send", pending.id, { text: pending.text }, id => this.sender.send(pending.text, id));
    this.logger?.info("LLM balance notification", { accountId: sample.accountId, notificationKind: pending.kind,
      outcome: receipt.status, operationId: receipt.operationId, resultId: receipt.result?.messageId });
    state.delivery = receipt.status;
    if (receipt.status === "accepted") {
      if (pending.kind === "balance") { state.level = pending.level; state.sentAt = now.getTime(); }
      else state.queryFailed = pending.kind === "query_failed";
      delete state.pending;
    } else if (receipt.status === "failed") {
      delete state.pending; // A definite rejection can be retried as a new event on a later scheduled check.
    }
    await this.kv.setJson("llm-balance-alert", sample.accountId, state);
  }

  async status(accountId: string) {
    const state = await this.kv.getJson<AlertState>("llm-balance-alert", accountId);
    return { level: state?.level ?? "healthy", delivery: state?.delivery, pending: Boolean(state?.pending) };
  }
}
