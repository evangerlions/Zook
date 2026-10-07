import assert from "node:assert/strict";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "./credits-http-runtime.ts";

// Fresh real HTTP/encryption/auth/business runtime. Storage, provider and payment
// evidence are explicit local doubles; no live purchase or model cost is incurred.
const fixture = await startCreditsHttpRuntime(3193);
const headers = { authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel", "Content-Type": "application/json" };
const balance = async () => {
  const response = await fetch(`${fixture.url}/api/v1/ai_novel/credits`, { headers });
  assert.equal(response.status, 200);
  return (await response.json()).data;
};
const free = await balance();
assert.equal(free.tier, "free");
const now = new Date();
const start = new Date(now.getTime() - 3 * 86400000).toISOString();
const expiresAt = new Date(now.getTime() + 27 * 86400000).toISOString();
await fixture.runtime.database.upsertAiNovelBillingTransaction({ appId: "ai_novel", userId: "user_alice", provider: "revenuecat",
  providerTransactionId: "usage-smoke-payment", productId: "plus_monthly", productKey: "plus_monthly", source: "app_store",
  platform: "ios", status: "provider_paid", purchasedAt: start, originalPurchaseDate: start, expiresAt,
  refundedAt: null, autoRenew: true, isSandbox: true, amountMinor: 100, refundAmountMinor: null, currency: "USD",
  observedAt: now.toISOString(), accountDeletedAt: null });
await fixture.runtime.database.upsertAiNovelBillingMembership({ appId: "ai_novel", userId: "user_alice", active: true,
  state: "active", tier: "plus", planKey: "plus_monthly", expiresAt, autoRenew: true, source: "app_store",
  managementUrl: null, lastSyncedAt: now.toISOString(), accountDeletedAt: null });
const plus = await balance();
assert.equal(plus.periodicMicros, 1000000000);
assert.equal(plus.refreshAt, new Date(Date.parse(start) + 7 * 86400000).toISOString());
const response = await fetch(`${fixture.url}/api/v1/ai_novel/ai/chat-completions`, {
  headers, method: "POST", body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1",
    messages: [{ role: "user", content: "write" }], stream: true })),
});
const events = (await response.text()).split("\n").filter(line => line.startsWith("data: "))
  .map(line => decodeCreditsFixture(JSON.parse(line.slice(6)))).map(e => e.data ?? e) as Array<{ type: string }>;
assert.equal(events.at(-1)?.type, "done");
assert.equal((await balance()).periodicMicros, 998600000);
const current = (await fixture.runtime.database.findAiNovelBillingMembership("ai_novel", "user_alice"))!;
await fixture.runtime.database.upsertAiNovelBillingMembership({ ...current, tier: "pro", planKey: "pro_monthly", lastSyncedAt: new Date().toISOString() });
const pro = await balance();
assert.equal(pro.periodicMicros, 3998600000);
assert.equal(pro.refreshAt, plus.refreshAt);
console.log(JSON.stringify({ evidence: "usage-http-smoke", url: fixture.url, result: "passed", mocked: ["storage", "provider", "payment evidence"],
  providerCalls: fixture.calls(), plusRemainingMicros: 998600000, proRemainingMicros: pro.periodicMicros, refreshAt: pro.refreshAt }));
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { void fixture.close().then(() => process.exit(0)); });
