import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { parseGeyanPageResult } from "../../src/modules/billing-accounts/manual/geyan-page-query.ts";
import { readConsoleFields } from "../../src/modules/billing-accounts/manual/console-reader.ts";
import { allowedProviderUrl } from "../../src/modules/billing-accounts/manual/provider-pages.ts";
import { parseLoginInput } from "../../src/modules/billing-accounts/manual/browser-session.ts";
import { SessionVault } from "../../src/modules/billing-accounts/manual/session-vault.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { AccountMonitor } from "../../src/modules/billing-accounts/account-monitor.ts";
import { defaultBalanceConfig } from "../../src/modules/llm-balances/balance-models.ts";
test("console readers accept only unique labelled remaining amounts and preserve native units", () => {
 assert.equal(readConsoleFields("token-plan", [{ label: "剩余 Credits", value: "12,345 Credits" }]).metrics[0].remaining, 12345);
 for (const fields of [[], [{ label: "总额度", value: "100 Credits" }], [{ label: "剩余额度", value: "50%" }], [{ label: "剩余额度", value: "100" }],
  [{ label: "剩余额度", value: "10 Credits" }, { label: "剩余额度", value: "20 Credits" }]]) assert.equal(readConsoleFields("token-plan", fields).status, "error");
});
test("provider navigation and remote inputs reject arbitrary URLs, commands and coordinates", () => {
 assert.equal(allowedProviderUrl("geyan", "https://dev.getui.com/"), true);
 for (const url of ["http://dev.getui.com/", "https://dev.getui.com.evil.test/", "https://127.0.0.1/", "https://evil@dev.getui.com/", "https://dev.getui.com:123/", "file:///etc/passwd", "https://bailian.console.aliyun.com/"]) assert.equal(allowedProviderUrl("geyan", url), false);
 assert.deepEqual(parseLoginInput({ kind: "key", key: "Tab" }), { kind: "key", key: "Tab" });
 for (const input of [{ kind: "key", key: "F12" }, { kind: "pointer", points: [{ x: -1, y: 0 }] }, { kind: "text", text: "" }, { kind: "scroll", deltaY: Infinity }, { kind: "navigate", url: "http://localhost" }]) assert.throws(() => parseLoginInput(input));
});
test("browser state encrypted and bound to account, rotation rewrap and deletion do not reveal cookies", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const old = new SessionVault(kv, ["old"]);
 const state = JSON.stringify({ cookies: [{ value: "private-cookie" }] }); await old.save("account1", state);
 const ciphertext = await kv.getString("billing-browser-state", "account1"); assert.equal(ciphertext?.includes("private-cookie"), false);
 await kv.setString("billing-browser-state", "account2", ciphertext!); await assert.rejects(old.load("account2"));
 assert.equal(await new SessionVault(kv, ["new", "old"]).load("account1"), state);
 assert.equal(await new SessionVault(kv, ["new"]).load("account1"), state);
 await old.clear("account1"); assert.equal(await old.load("account1"), undefined);
 await assert.rejects(new SessionVault(kv, []).save("account1", state));
});
test("manual browser result uses one persistence path, retains last balance on read failure and never alerts or schedules", async () => {
 const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); const store = new AccountStore(kv, ["key"]);
 const a = await store.save({ name: "GeYan", type: "geyan", providers: [], alerts: false, warning: 1, critical: 0 });
 let alerts = 0, requests = 0;
 const monitor = new AccountMonitor(store, kv, { get: async () => defaultBalanceConfig() } as any, { evaluate: async () => alerts++, status: async () => ({ level: "healthy" }) } as any,
  async () => { requests++; throw Error("Unexpected automatic query"); });
 const at = new Date("2026-11-15T00:00:00Z");
 await monitor.recordManual(a.id, parseGeyanPageResult({authenticated:true,responses:[{businessCode:"ct-login",status:200,errno:0,remainderNum:88},{businessCode:"ct-login-h5",status:200,errno:0,remainderNum:0}]}), at);
 const failure = await monitor.recordManual(a.id, { status: "error", metrics: [] }, new Date(at.getTime() + 1000));
 assert.equal(failure.metrics[0].remaining, 88); assert.equal(failure.lastSuccessAt, at.toISOString()); assert.equal(failure.stale, true);
 await monitor.runDueChecks(); assert.equal(alerts, 0); assert.equal(requests, 0);
});

test("balance page scope excludes provider home, login and unrelated subscriptions", async () => {
 const { isBalancePage } = await import("../../src/modules/billing-accounts/manual/provider-pages.ts");
 assert.equal(isBalancePage("token-plan", "https://bailian.console.aliyun.com/#/token-plan"), true);
 assert.equal(isBalancePage("agent-plan", "https://console.volcengine.com/ark/region:cn-beijing/subscription/agent-plan"), true);
 assert.equal(isBalancePage("agent-plan", "https://console.volcengine.com/ark/region%3Acn-beijing/subscription/agent-plan/"), true);
 assert.equal(isBalancePage("agent-plan", "https://console.volcengine.com/ark/#/agent-plan"), false);
 assert.equal(isBalancePage("agent-plan", "https://www.volcengine.com/ark/region:cn-beijing/subscription/agent-plan"), false);
 assert.equal(isBalancePage("geyan", "https://dev.getui.com/#/gy/usage"), true);
 for (const url of ["https://bailian.console.aliyun.com/", "https://bailian.console.aliyun.com/#/harness", "https://bailian.console.aliyun.com/#/models"]) assert.equal(isBalancePage("token-plan", url), false);
 assert.equal(isBalancePage("geyan", "https://dev.getui.com/"), false);
});

test("dedicated credential input validates both fields, trims account only and preserves password", () => {
 assert.deepEqual(parseLoginInput({ kind: "credentials", username: " account ", password: " pass " }), { kind: "credentials", username: "account", password: " pass " });
 for (const input of [{ kind: "credentials", username: "", password: "pass" }, { kind: "credentials", username: "account", password: "" }, { kind: "credentials", username: "account", password: 123 }]) assert.throws(() => parseLoginInput(input));
});
