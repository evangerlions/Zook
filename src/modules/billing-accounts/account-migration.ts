import { randomUUID } from "node:crypto";
import type { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import type { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import type { CommonPasswordConfigService } from "../../services/common-password-config.service.ts";
import type { BalanceConfigStore } from "../llm-balances/balance-config.ts";
import type { AccountStore } from "./account-store.ts";
export function accountMigration(kv: KVManager, store: AccountStore, config: BalanceConfigStore, llm: CommonLlmConfigService,
  passwords: CommonPasswordConfigService, encryptionReady: boolean) {
  return async function prepare(attempt = 0): Promise<void> {
    if (!encryptionReady || await kv.getString("billing-migration", "done")) return;
    const owner = randomUUID();
    if (!await kv.setStringIfAbsent("billing-migration", "lock", owner, 60)) {
      if (attempt >= 20) throw new Error("Billing migration is busy; retry shortly");
      await new Promise(resolve => setTimeout(resolve, 100)); return prepare(attempt + 1);
    }
    try {
      const old = await config.get(); const providers = (await llm.getCurrentConfig()).providers;
      const groups = new Map<string, typeof providers>();
      const aliases = new Map<string, string>();
      for (const p of providers) {
        const type = p.type ?? p.key; if (type !== "openrouter" && type !== "bai") continue;
        const credentialId = `${type}:${p.apiKey || p.key}`;
        const defaultId = aliases.get(credentialId) ?? p.key; aliases.set(credentialId, defaultId);
        const group = old.rules.find(r => r.provider === p.key)?.accountId ?? defaultId;
        groups.set(group, [...(groups.get(group) ?? []), p]);
      }
      for (const [group, ps] of groups) {
        const matches = (await store.list()).filter(a => ps.some(p => a.providers.includes(p.key)));
        if (matches.length > 1) throw new Error("Legacy balance group requires explicit account reconciliation");
        const existing = matches[0];
        const p = ps[0], type = p.type ?? p.key;
        const rule = old.rules.find(r => r.accountId === group);
        let credential: string | undefined;
        if (type === "openrouter" && rule?.managementPasswordKey) credential = await passwords.getValue(rule.managementPasswordKey);

        await store.save({ ...(existing ? { id: existing.id } : {}), name: existing?.name ?? p.label ?? p.key, type, providers: [...new Set([...(existing?.providers ?? []), ...ps.map(p => p.key)])], alerts: existing?.alerts ?? rule?.alerts ?? type === "openrouter",
          warning: existing?.warning ?? rule?.warning ?? 20, critical: existing?.critical ?? rule?.critical ?? 5, ...(!existing?.credentialConfigured && credential ? { credential } : {}) });
      }
      if (old.rules.length) await config.save({ ...old, rules: [] }, "Migrate balance rules to billing accounts");
      await kv.setString("billing-migration", "done", "1");
    } finally { await kv.applyAtomic("billing-migration", { compare: [{ key: "lock", value: owner }], set: [{ key: "lock", value: "released", ttlSeconds: 1 }] }); }
  };
}
