import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { AccountMonitor } from "../../src/modules/billing-accounts/account-monitor.ts";
import { parseBailianTokenPlanQuota } from "../../src/modules/billing-accounts/bailian-token-plan-query.ts";
import { parseCloudBalance, cloudRequest } from "../../src/modules/billing-accounts/cloud-query.ts";
import { defaultBalanceConfig } from "../../src/modules/llm-balances/balance-models.ts";
const draft = (type = "openrouter") => ({ name: "Test", type, providers: [], alerts: false, warning: 20, critical: 5 });
test("account credentials are encrypted, masked by omission, preserved on edit and readable with previous rotation key", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const store = new AccountStore(kv, ["key1"]);
 const a = await store.save({ ...draft(), credential: "secret-123" });
 assert.equal(JSON.stringify(await store.list()).includes("secret-123"), false);
 assert.equal((await kv.getString("billing-accounts", "accounts"))?.includes("secret-123"), false);
 await store.save({ ...draft(), id: a.id, name: "Renamed" }); assert.equal(await store.credential(a.id), "secret-123");
 assert.equal(await new AccountStore(kv, ["key2", "key1"]).credential(a.id), "secret-123");
 await assert.rejects(store.save({ ...draft(), id: a.id, credential: "***" }));
});
test("manual sources are excluded server-side even when worker runs; explicit refresh rejects without network", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const store = new AccountStore(kv, ["key"]);
 for (const type of ["token-plan", "agent-plan", "geyan"]) await store.save(draft(type));
 let queries = 0;
 const monitor = new AccountMonitor(store, kv, { get: async () => defaultBalanceConfig() } as any, { status: async () => ({ level: "healthy" }) } as any,
   async () => { queries++; throw Error("Unexpected query"); });
 assert.deepEqual(await monitor.runDueChecks(), { checked: 0 });
 for (const a of await store.list()) await assert.rejects(monitor.refresh(a.id));
 assert.equal(queries, 0); await assert.rejects(store.save({ ...draft("geyan"), alerts: true }));
});
test("cloud response units, missing and provider error envelopes do not turn into zero balances", () => {
 assert.equal(parseCloudBalance("tencent", { Response: { RealBalance: 12345 } }).metrics[0].remaining, 123.45);
 assert.equal(parseCloudBalance("aliyun", { Success: true, Data: { AvailableAmount: "1,234.56", Currency: "CNY" } }).metrics[0].remaining, 1234.56);
 assert.equal(parseCloudBalance("volcengine", { Result: { AvailableBalance: "-1.2" } }).metrics[0].remaining, -1.2);
 assert.throws(() => parseCloudBalance("tencent", { Response: { Error: { Code: "Denied" } } }));
 assert.throws(() => parseCloudBalance("aliyun", { Success: true, Data: { Currency: "CNY" } }));
});

test("Bailian only maps valid monthly usage ratios and preserves the reset time", () => {
 const sample = parseBailianTokenPlanQuota(JSON.stringify({
  hasQuotaData: true, per1MonthPercentage: 0.25, per1MonthResetTime: 1796000000000, per1WeekPercentage: 0.9,
 }));
 assert.deepEqual(sample, { status: "ok", metrics: [{
  kind: "token_plan_monthly_remaining", scope: "personal", remaining: 75, unit: "%", resetAt: "2026-11-30T00:53:20.000Z",
 }] });
 for (const invalid of [{ hasQuotaData: false, per1MonthPercentage: 0 },
  { hasQuotaData: true, per1WeekPercentage: 0.5 }, { hasQuotaData: true, per1MonthPercentage: 42 }]) {
  assert.equal(parseBailianTokenPlanQuota(JSON.stringify(invalid)).status, "error");
 }
 for (const [used, remaining] of [[0, 100], [1, 0]]) {
  assert.equal(parseBailianTokenPlanQuota(JSON.stringify({ hasQuotaData: true, per1MonthPercentage: used })).metrics[0].remaining, remaining);
 }
});

test("configured Bailian queries use the worker and preserve the last quota on failure", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
 const store = new AccountStore(kv, ["test-key"]);
 const manual = await store.save(draft("token-plan"));
 await assert.rejects(store.save({ ...draft("token-plan"), credential: "sk-sp-wrong-kind" }));
 const credential = JSON.stringify({ accessKey: "fixture-ak", secretKey: "fixture-sk" });
 const automated = await store.save({ ...draft("token-plan"), credential });
 assert.equal(automated.mode, "automatic");
 assert.equal((await store.save({ ...draft("token-plan"), id: automated.id })).mode, "automatic");
 await assert.rejects(store.save({ ...draft("token-plan"), id: automated.id, warning: 101 }));
 assert.doesNotMatch(JSON.stringify(await store.list()), /fixture-ak|fixture-sk/);

 let queries = 0;
 const monitor = new AccountMonitor(store, kv, { get: async () => defaultBalanceConfig() } as any,
  { evaluate: async () => {}, status: async () => ({ level: "healthy" }) } as any,
  async () => { throw new Error("Unexpected cash balance query"); }, undefined, undefined, undefined,
  async (value) => {
   assert.equal(value, credential);
   return ++queries === 1
    ? { status: "ok", metrics: [{ kind: "token_plan_monthly_remaining", scope: "personal", remaining: 75, unit: "%" }] }
    : { status: "unauthorized", metrics: [] };
  });
 assert.deepEqual(await monitor.runDueChecks(), { checked: 1 });
 assert.equal(queries, 1);
 await assert.rejects(monitor.refresh(manual.id));
 await assert.rejects(monitor.recordManual(automated.id, { status: "ok", metrics: [] }));
 await kv.delete("billing-lock", automated.id);
 const failed = await monitor.refresh(automated.id);
 assert.equal(failed.status, "unauthorized");
 assert.equal(failed.stale, true);
 assert.equal(failed.metrics[0].remaining, 75);
});
test("signed cloud requests target fixed financial endpoints and carry no configurable destination", () => {
 for (const type of ["aliyun", "tencent", "volcengine"] as const) {
  const [url, options] = cloudRequest(type, "access", "secret", new Date("2026-11-15T00:00:00Z"));
  assert.equal(new URL(url).protocol, "https:"); assert.equal(url.includes("secret"), false);
  assert.ok(type === "aliyun" ? url.includes("Signature=") : new Headers(options.headers).has("authorization"));
 }
});

test("rotation rewrap survives removal of previous key after a successful query", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
 const original = new AccountStore(kv, ["old"]); const a = await original.save({ ...draft(), credential: "saved" });
 assert.equal(await new AccountStore(kv, ["new", "old"]).credential(a.id), "saved");
 assert.equal(await new AccountStore(kv, ["new"]).credential(a.id), "saved");
 await assert.rejects(new AccountStore(kv, []).save({ ...draft(), credential: "never-store-with-random-key" }));
});

test("legacy implicit shared providers migrate once under concurrent API/worker startup", async () => {
 const { accountMigration } = await import("../../src/modules/billing-accounts/account-migration.ts");
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const store = new AccountStore(kv, ["key"]);
 const config = { get: async () => defaultBalanceConfig(), save: async () => {} } as any;
 const llm = { getCurrentConfig: async () => ({ providers: [{ key: "first", type: "bai", apiKey: "same" }, { key: "second", type: "bai", apiKey: "same" }] }) } as any;
 const prepare = accountMigration(kv, store, config, llm, {} as any, true);
 await Promise.all([prepare(), prepare()]);
 const accounts = await store.list(); assert.equal(accounts.length, 1); assert.deepEqual(accounts[0].providers, ["first", "second"]);
 assert.equal(await store.credential(accounts[0].id), undefined); assert.equal(accounts[0].credentialSource, "llm");
});
