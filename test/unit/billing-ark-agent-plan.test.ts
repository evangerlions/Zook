import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { AccountStore } from "../../src/modules/billing-accounts/account-store.ts";
import { AccountMonitor } from "../../src/modules/billing-accounts/account-monitor.ts";
import { arkQuotaWindows, parseArkQuota } from "../../src/modules/billing-accounts/ark-agent-plan-quota.ts";
import { BalanceAlerts } from "../../src/modules/llm-balances/balance-alerts.ts";
import { defaultBalanceConfig } from "../../src/modules/llm-balances/balance-models.ts";
import { IntegrationReceipts } from "../../src/modules/feishu/integration-receipts.ts";
import type { FeishuClient } from "../../src/modules/feishu/feishu-client.ts";

function response(used: number[]) {
  return { Result: Object.fromEntries(arkQuotaWindows.map(({ field }, i) => [
    field, { Quota: i === 0 ? "100.0" : 100, Used: i === 0 ? String(used[i]) : used[i], ResetTime: 1795560000000 },
  ])) };
}

test("Ark quota keeps the three monitored windows and each reset time", () => {
  const sample = parseArkQuota(response([0, 95, 110]));
  assert.equal(sample.status, "ok");
  assert.deepEqual(sample.metrics.map(m => [m.kind, m.remaining, m.resetAt]), [
    ["agent_plan_5h_remaining", 100, "2026-11-24T22:40:00.000Z"],
    ["agent_plan_weekly_remaining", 5, "2026-11-24T22:40:00.000Z"],
    ["agent_plan_monthly_remaining", 0, "2026-11-24T22:40:00.000Z"],
  ]);
  assert.equal(parseArkQuota(response([0, 95])).status, "error");
  assert.equal(parseArkQuota({ ResponseMetadata: { Error: { Code: "AccessDenied" } } }).status, "unauthorized");
});

test("scheduled checks sign the official Ark request and alert and recover by window", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = new AccountStore(kv, ["key"]);
  const draft = { type: "agent-plan", name: "Ark", providers: [], alerts: true, warning: 20, critical: 5 };
  await assert.rejects(store.save({ ...draft, credential: "inference-key" }));
  await assert.rejects(store.save({ ...draft, warning: 101, credential: '{"accessKey":"a","secretKey":"s"}' }));
  const account = await store.save({ ...draft, credential: '{"accessKey":"a","secretKey":"s"}' });
  assert.equal(account.mode, "automatic");
  const messages: string[] = [];
  const sender = {
    ready: async () => true,
    send: async (message: string) => { messages.push(message); return { messageId: String(messages.length) }; },
  } as unknown as FeishuClient;
  const alerts = new BalanceAlerts(kv, sender, new IntegrationReceipts(kv));
  const config = { get: async () => defaultBalanceConfig() };
  let used = [90, 98, 10];
  let failing = false;
  const monitor = new AccountMonitor(store, kv, config as any, alerts, async (url, options) => {
    assert.equal(url, "https://ark.cn-beijing.volcengineapi.com/?Action=GetAFPUsage&Version=2024-01-01");
    assert.equal(options?.method, "POST");
    assert.equal(options?.body, "{}");
    assert.match(new Headers(options?.headers).get("Authorization") ?? "", /cn-beijing\/ark\/request, SignedHeaders=content-type;host;x-content-sha256;x-date/);
    return failing ? new Response(null, { status: 403 }) : Response.json(response(used));
  });
  const at = (minutes: number) => new Date(Date.UTC(2030, 0, 1) + minutes * 60000);
  assert.deepEqual(await monitor.runDueChecks(at(0)), { checked: 1 });
  assert.deepEqual(await monitor.runDueChecks(at(1)), { checked: 0 });
  assert.equal(messages.length, 2);
  assert.match(messages[0], /5-hour quota[\s\S]*WARNING.*10% remaining/);
  assert.match(messages[1], /Weekly quota[\s\S]*CRITICAL.*2% remaining/);
  assert.equal((await monitor.document()).accounts[0].alert.level, "critical");
  const tick = async (minute: number) => {
    await kv.delete("billing-lock", account.id); // The test clock skips the one-second lease cooldown.
    return monitor.runDueChecks(at(minute));
  };
  used = [10, 98, 83];
  await tick(5);
  assert.equal(messages.length, 3);
  assert.match(messages[2], /Monthly quota[\s\S]*WARNING.*17% remaining/);
  await tick(10);
  assert.equal(messages.length, 4);
  assert.match(messages[3], /5-hour quota[\s\S]*recovered/);
  failing = true;
  for (const minute of [15, 20, 25]) await tick(minute);
  assert.equal(messages.length, 5);
  assert.match(messages[4], /query failed 3 consecutive times/);
  const { sample } = (await monitor.document()).accounts[0];
  assert.equal(sample?.stale, true);
  assert.equal(sample?.metrics.length, 3);
});
