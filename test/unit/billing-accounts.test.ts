import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { AccountMonitor } from "../../src/modules/billing-accounts/account-monitor.ts";
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
