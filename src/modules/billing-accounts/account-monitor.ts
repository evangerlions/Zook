import type { BillingProviderOption } from "./provider-links.ts";
import { createHash, randomUUID } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { BalanceAlerts } from "../llm-balances/balance-alerts.ts";
import type { BalanceConfigStore } from "../llm-balances/balance-config.ts";
import type { BalanceSnapshot, BalanceSample } from "../llm-balances/balance-models.ts";
import { queryProviderBalance } from "../llm-balances/balance-adapters.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { AccountStore, manualTypes, type BillingAccount } from "./account-store.ts";
import { queryCloudBalance } from "./cloud-query.ts";
export class AccountMonitor {
  constructor(readonly store: AccountStore, private readonly kv: KVManager, private readonly config: BalanceConfigStore,
    private readonly alerts: BalanceAlerts, private readonly fetcher: typeof fetch = fetch, private readonly prepare: () => Promise<void> = async () => {},
    private readonly queryCredential: (account: BillingAccount) => Promise<string | undefined> = account => store.credential(account.id),
    private readonly providerOptions: () => Promise<BillingProviderOption[]> = async () => []) {}
  async document() {
    await this.prepare();
    const accounts = await this.store.list();
    return { providerOptions: await this.providerOptions(), accounts: await Promise.all(accounts.map(async a => ({ ...a, credentialConfigured: a.credentialSource === "llm" ? Boolean(await this.queryCredential(a).catch(() => undefined)) : a.credentialConfigured, sample: await this.snapshot(a.id), alert: await this.alerts.status(a.id) }))), config: { ...(await this.config.get()), rules: [] } };
  }
  private async snapshot(id: string) {
    const sample = await this.kv.getJson<BalanceSnapshot>("billing-samples", id);
    const a = await this.store.get(id);
    if (sample) delete sample.fingerprint;
    return sample ? { ...sample, stale: (manualTypes.includes(a.type) && sample.loginRevision !== a.loginRevision) || a.updatedAt > (sample.checkedAt ?? "") || sample.stale || !sample.lastSuccessAt || Date.now() - Date.parse(sample.lastSuccessAt) > (await this.config.get()).intervalMinutes * 120000 } : undefined;
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
    if (!manualTypes.includes(a.type)) throw new ApplicationError(400, "REQ_INVALID_BODY", "Account is not a manual query source.");
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
    if (manualTypes.includes(a.type)) throw new ApplicationError(409, "REQ_INVALID_BODY", "Use the official console to query this manual account.");
    const owner = randomUUID();
    if (!await this.kv.setStringIfAbsent("billing-lock", id, owner, 60)) throw new ApplicationError(409, "REQ_INVALID_BODY", "Balance query is already running.");
    try {
      let credential: string | undefined; let credentialFailed = false;
      try { credential = await this.queryCredential(a); } catch { credentialFailed = true; }
      const result = credentialFailed ? { status: "error" as const, metrics: [], detail: "Billing credential could not be decrypted. Check the API and worker encryption configuration." } : a.type === "openrouter" || a.type === "bai" ? await queryProviderBalance(a.type, credential, this.fetcher) : await queryCloudBalance(a.type, credential, this.fetcher);
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
      await this.kv.setJson("billing-samples", id, sample);
      await this.alerts.evaluate(sample, { provider: a.type, accountId: id, alerts: a.alerts, warning: a.warning, critical: a.critical }, config, now);
      return sample;
    } finally { await this.kv.applyAtomic("billing-lock", { compare: [{ key: id, value: owner }], set: [{ key: id, value: "released", ttlSeconds: 1 }] }); }
  }
}
