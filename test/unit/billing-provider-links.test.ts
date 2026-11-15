import assert from "node:assert/strict";
import test from "node:test";
import { billingProviderOptions } from "../../src/modules/billing-accounts/provider-links.ts";
import { AccountMonitor } from "../../src/modules/billing-accounts/account-monitor.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { defaultBalanceConfig } from "../../src/modules/llm-balances/balance-models.ts";

test("provider catalog uses actual keys and provider types, with no credential fields", () => {
  const providers = [
    { key: "OPENROUTER_BACKUP", type: "openrouter", label: "Backup", apiKey: "private-model-key", baseUrl: "https://upstream.test" },
    { key: "openrouter", label: "Primary" },
    { key: "plan", type: "bailian_coding", label: "Token Plan" },
    { key: "unsupported", type: "openai" },
    { key: "constructor" },
  ];
  assert.deepEqual(billingProviderOptions(providers), [
    { key: "OPENROUTER_BACKUP", label: "Backup", accountType: "openrouter" },
    { key: "openrouter", label: "Primary", accountType: "openrouter" },
    { key: "plan", label: "Token Plan", accountType: "token-plan" },
  ]);
  assert.equal(JSON.stringify(billingProviderOptions(providers)).includes("private-model-key"), false);
});

test("billing document exposes current safe provider metadata without a copied catalog store", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new AccountStore(kv, ["test"]);
  let providers = [{ key: "backup", type: "openrouter", label: "Backup" }];
  const monitor = new AccountMonitor(store, kv, { get: async () => defaultBalanceConfig() } as any,
    { status: async () => ({ level: "healthy" }) } as any, undefined, undefined, undefined, async () => billingProviderOptions(providers));
  assert.equal((await monitor.document()).providerOptions[0].key, "backup");
  providers = [{ key: "bai", type: "bai", label: "B.AI" }];
  assert.deepEqual((await monitor.document()).providerOptions, [{ key: "bai", label: "B.AI", accountType: "bai" }]);
});
