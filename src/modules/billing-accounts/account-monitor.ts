import { arkQuotaWindows, queryArkQuota } from "./ark-agent-plan-quota.ts";
import type { BillingProviderOption } from "./provider-links.ts";
import { createHash, randomUUID } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { BalanceAlerts } from "../llm-balances/balance-alerts.ts";
import type { BalanceConfigStore } from "../llm-balances/balance-config.ts";
import type { BalanceSnapshot, BalanceSample, BalanceRule, BalanceConfig } from "../llm-balances/balance-models.ts";
import { queryProviderBalance } from "../llm-balances/balance-adapters.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { AccountStore, queryMode, type BillingAccount } from "./account-store.ts";
import { queryBailianTokenPlan } from "./bailian-token-plan-query.ts";
import { queryCloudBalance } from "./cloud-query.ts";
export class AccountMonitor {
  constructor(readonly store: AccountStore, private readonly kv: KVManager, private readonly config: BalanceConfigStore,
    private readonly alerts: BalanceAlerts, private readonly fetcher: typeof fetch = fetch, private readonly prepare: () => Promise<void> = async () => {},
    private readonly queryCredential: (account: BillingAccount) => Promise<string | undefined> = account => store.credential(account.id),
    private readonly providerOptions: () => Promise<BillingProviderOption[]> = async () => [],
    private readonly queryTokenPlan = queryBailianTokenPlan) {}
  async document() {
    await this.prepare();
    const accounts = await this.store.list();
    return { providerOptions: await this.providerOptions(), accounts: await Promise.all(accounts.map(async a => ({ ...a, credentialConfigured: a.credentialSource === "llm" ? Boolean(await this.queryCredential(a).catch(() => undefined)) : a.credentialConfigured, sample: await this.snapshot(a.id), alert: await this.alerts.status(a.id, a.type === "agent-plan" ? arkQuotaWindows : undefined) }))), config: { ...(await this.config.get()), rules: [] } };
  }
  private async snapshot(id: string) {
    const sample = await this.kv.getJson<BalanceSnapshot>("billing-samples", id);
    const a = await this.store.get(id);
    if (sample) { delete sample.fingerprint; delete sample.windowSafeSamples; }
    return sample ? { ...sample, stale: (queryMode(a) === "manual" && sample.loginRevision !== a.loginRevision) || a.updatedAt > (sample.checkedAt ?? "") || sample.stale || !sample.lastSuccessAt || Date.now() - Date.parse(sample.lastSuccessAt) > (await this.config.get()).intervalMinutes * 120000 } : undefined;
  }
  async runDueChecks(now = new Date()) {
    await this.prepare();
    const config = await this.config.get(); let checked = 0;
    for (const a of await this.store.list()) {
      if (a.mode === "manual") continue;
      const previous = await this.kv.getJson<BalanceSnapshot>("billing-samples", a.id);
      if (previous?.checkedAt && now.getTime() - Date.parse(previous.checkedAt) < config.intervalMinutes * 60000) continue;
      try { await this.refresh(a.id, now); checked++; } catch { /* Other accounts must still be checked. */ }
    }
    return { checked };
  }
  async recordManual(id: string, result: BalanceSample, now = new Date(), loginRevision?: string) {
    const a = await this.store.get(id);
    if (queryMode(a) !== "manual") throw new ApplicationError(400, "REQ_INVALID_BODY", "Account is not a manual query source.");
    const previous = await this.kv.getJson<BalanceSnapshot>("billing-samples", id);
    const sample: BalanceSnapshot = { ...result, sourceType: a.type, loginRevision, provider: a.type, label: a.name, accountId: id, sharedWith: a.providers,
      metrics: result.status === "ok" ? result.metrics : previous?.metrics ?? [], checkedAt: now.toISOString(),
      lastSuccessAt: result.status === "ok" ? now.toISOString() : previous?.lastSuccessAt, stale: result.status !== "ok",
      failures: 0, safeSamples: 0, successfulSamples: 0 };
    await this.kv.setJson("billing-samples", id, sample);
    return sample;
  }
  async refresh(id: string, now = new Date()) {
    const a = await this.store.get(id);
    if (queryMode(a) === "manual") throw new ApplicationError(409, "REQ_INVALID_BODY", "Use the official console to query this manual account.");
    const owner = randomUUID();
    if (!await this.kv.setStringIfAbsent("billing-lock", id, owner, 60)) throw new ApplicationError(409, "REQ_INVALID_BODY", "Balance query is already running.");
    try {
      const { result, credential } = await this.query(a);
      const current = await this.store.get(id);
      if (current.updatedAt !== a.updatedAt) {
        throw new ApplicationError(409, "REQ_INVALID_BODY", "Billing account changed during the query. Refresh again.");
      }
      const previous = await this.kv.getJson<BalanceSnapshot>("billing-samples", id);
      const config = await this.config.get();
      const fingerprint = createHash("sha256").update(JSON.stringify([a.type, credential, a.warning, a.critical, a.alerts, config.intervalMinutes])).digest("hex");
      const consecutive = previous?.fingerprint === fingerprint ? previous : undefined;
      const amount = result.metrics[0]?.remaining;
      const sample: BalanceSnapshot = { ...result, sourceType: a.type, provider: a.type, label: a.name, accountId: id, sharedWith: a.providers,
        metrics: result.status === "ok" ? result.metrics : previous?.metrics ?? [], checkedAt: now.toISOString(),
        lastSuccessAt: result.status === "ok" ? now.toISOString() : previous?.lastSuccessAt, stale: result.status !== "ok",
        failures: result.status === "ok" ? 0 : (consecutive?.failures ?? 0) + 1,
        successfulSamples: result.status === "ok" ? (consecutive?.successfulSamples ?? 0) + 1 : 0,
        fingerprint, safeSamples: result.status === "ok" && amount != null && amount >= a.warning ? (consecutive?.safeSamples ?? 0) + 1 : 0 };
      if (a.type === "agent-plan" && result.status === "ok") {
        sample.windowSafeSamples = Object.fromEntries(result.metrics.map(metric => [metric.kind,
          metric.remaining !== null && metric.remaining >= a.warning ? (consecutive?.windowSafeSamples?.[metric.kind] ?? 0) + 1 : 0]));
      }
      await this.kv.setJson("billing-samples", id, sample);
      const rule = { provider: a.type, accountId: id, alerts: a.alerts, warning: a.warning, critical: a.critical };
      await this.evaluateAlerts(sample, rule, config, now);
      const { windowSafeSamples: _windowSafeSamples, ...visible } = sample;
      return visible;
    } finally { await this.kv.applyAtomic("billing-lock", { compare: [{ key: id, value: owner }], set: [{ key: id, value: "released", ttlSeconds: 1 }] }); }
  }

  private async evaluateAlerts(sample: BalanceSnapshot, rule: BalanceRule, config: BalanceConfig, now: Date) {
    if (rule.provider !== "agent-plan") return this.alerts.evaluate(sample, rule, config, now);

    // Provider availability is shared. Only quota levels and recovery counts are per window.
    await this.alerts.evaluate({ ...sample, metrics: [] }, rule, config, now);
    if (sample.status !== "ok") return;
    for (const window of arkQuotaWindows) {
      const metrics = sample.metrics.filter(metric => metric.kind === window.kind);
      await this.alerts.evaluate({ ...sample, metrics, safeSamples: sample.windowSafeSamples?.[window.kind] ?? 0 }, rule, config, now, window);
    }
  }

  private async query(account: BillingAccount): Promise<{ result: BalanceSample; credential?: string }> {
    let credential: string | undefined;
    try {
      credential = await this.queryCredential(account);
    } catch {
      return { result: { status: "error", metrics: [], detail: "Billing credential could not be decrypted. Check the API and worker encryption configuration." } };
    }
    const { type } = account;
    if (type === "agent-plan") return { credential, result: await queryArkQuota(credential, this.fetcher) };
    if (type === "token-plan") return { credential, result: await this.queryTokenPlan(credential) };
    if (type === "openrouter" || type === "bai") return { credential, result: await queryProviderBalance(type, credential, this.fetcher) };
    return { credential, result: await queryCloudBalance(type, credential, this.fetcher) };
  }
}
