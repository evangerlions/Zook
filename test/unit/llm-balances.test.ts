import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { parseOpenRouterCredits, parseBaiBalance, queryProviderBalance } from "../../src/modules/llm-balances/balance-adapters.ts";
import { validateBalanceConfig } from "../../src/modules/llm-balances/balance-config.ts";
import { defaultBalanceConfig, type BalanceSnapshot, type BalanceRule } from "../../src/modules/llm-balances/balance-models.ts";
import { BalanceAlerts } from "../../src/modules/llm-balances/balance-alerts.ts";
import { IntegrationReceipts } from "../../src/modules/feishu/integration-receipts.ts";
import type { FeishuClient } from "../../src/modules/feishu/feishu-client.ts";

test("OpenRouter account credits use purchased minus used in USD; missing fields never become zero", () => {
  assert.deepEqual(parseOpenRouterCredits({ data: { total_credits: 100.5, total_usage: 25.75 } }).metrics,
    [{ kind: "account_balance", scope: "account", remaining: 74.75, unit: "USD" }]);
  assert.throws(() => parseOpenRouterCredits({ data: { limit_remaining: 10 } }));
});
test("BAI preserves personal, team and member scopes and native Credits", () => {
  assert.equal(parseBaiBalance({ success: true, data: { api_key_type: "personal", personal_balance: 0 } }).metrics[0].remaining, 0);
  const team = parseBaiBalance({ success: true, data: { api_key_type: "team", team: {
    team_role: "admin", team_balance: 8000000, quota_limit_type: "limited", member_quota_limit: 3000000, member_quota_used: 450000,
  } } });
  assert.deepEqual(team.metrics.map(item => [item.scope, item.remaining, item.unit]), [["team", 8000000, "Credits"], ["member", 2550000, "Credits"]]);
  const unlimited = parseBaiBalance({ success: true, data: { api_key_type: "team", team: { team_role: "member", quota_limit_type: "unlimited", member_quota_used: 450000 } } });
  assert.deepEqual(unlimited.metrics, [{ kind: "member_quota", scope: "member", remaining: null, unit: "Credits", unlimited: true }]);
  assert.throws(() => parseBaiBalance({ success: false }));
  assert.throws(() => parseBaiBalance({ success: true, data: { api_key_type: "personal" } }));
});
test("unsupported, missing credentials, forbidden and non-JSON failures have explicit states", async () => {
  const never: typeof fetch = async () => { throw new Error("unexpected query"); };
  assert.equal((await queryProviderBalance("bailian_token_plan", "key", never)).status, "unsupported");
  assert.equal((await queryProviderBalance("openrouter", undefined, never)).status, "unconfigured");
  assert.equal((await queryProviderBalance("openrouter", "key", async () => new Response("forbidden", { status: 403 }))).status, "unauthorized");
  assert.equal((await queryProviderBalance("bai", "key", async () => new Response("rate limit", { status: 429 }))).status, "error");
});
test("shared accounts require identical alert and credential rules; thresholds must be ordered", () => {
  const base = defaultBalanceConfig();
  assert.equal(validateBalanceConfig(base).intervalMinutes, 5);
  assert.throws(() => validateBalanceConfig({ ...base, intervalMinutes: 0 }));
  const rule = { provider: "main", accountId: "shared", alerts: true, warning: 20, critical: 5 };
  assert.throws(() => validateBalanceConfig({ ...base, rules: [rule, { ...rule, provider: "backup", critical: 6 }] }));
  assert.equal(validateBalanceConfig({ ...base, rules: [rule, { ...rule, provider: "backup" }] }).rules.length, 2);
});

const rule: BalanceRule = { provider: "backup", accountId: "backup", alerts: true, warning: 20, critical: 5 };
function sample(balance: number, overrides: Partial<BalanceSnapshot> = {}): BalanceSnapshot {
  return { provider: "backup", label: "Backup", accountId: "backup", sharedWith: [], status: "ok", stale: false,
    metrics: [{ kind: "account_balance", scope: "account", unit: "USD", remaining: balance }],
    failures: 0, safeSamples: 0, successfulSamples: 1, checkedAt: "2030-01-01T00:00:00Z", ...overrides };
}
async function alertFixture() {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const messages: string[] = [];
  const sender = { ready: async () => true, send: async (text: string) => { messages.push(text); return { messageId: `m${messages.length}` }; } } as unknown as FeishuClient;
  const create = () => new BalanceAlerts(kv, sender, new IntegrationReceipts(kv));
  return { kv, messages, create };
}
test("English balance alerts: warning/critical boundaries, repeat intervals and two-sample recovery persist across restart", async () => {
  const { messages, create } = await alertFixture(); const config = defaultBalanceConfig();
  const at = (hours: number) => new Date(Date.UTC(2030, 0, 1) + hours * 3600_000);
  await create().evaluate(sample(20), rule, config, at(0)); assert.equal(messages.length, 0);
  await create().evaluate(sample(19), rule, config, at(1)); assert.match(messages[0], /WARNING: Low balance/);
  await create().evaluate(sample(19), rule, config, at(2)); assert.equal(messages.length, 1);
  await create().evaluate(sample(19), rule, config, at(25)); assert.equal(messages.length, 2);
  await create().evaluate(sample(4), rule, config, at(26)); assert.match(messages[2], /CRITICAL/);
  await create().evaluate(sample(4), rule, config, at(29)); assert.equal(messages.length, 3);
  await create().evaluate(sample(4), rule, config, at(30)); assert.equal(messages.length, 4);
  await create().evaluate(sample(30, { safeSamples: 1 }), rule, config, at(31)); assert.equal(messages.length, 4);
  await create().evaluate(sample(30, { safeSamples: 2 }), rule, config, at(32)); assert.match(messages[4], /Balance recovered/);
  assert.ok(messages.every(text => !/[\u3400-\u9fff]/.test(text)));
});
test("three query failures notify once; recovery requires two successful polls, even while balance stays low", async () => {
  const { messages, create } = await alertFixture(); const config = defaultBalanceConfig();
  const now = new Date("2030-01-01T00:00:00Z");
  await create().evaluate(sample(0, { status: "error", failures: 2 }), rule, config, now); assert.equal(messages.length, 0);
  await create().evaluate(sample(0, { status: "error", failures: 3 }), rule, config, now); assert.match(messages[0], /Balance query failed/);
  await create().evaluate(sample(0, { status: "error", failures: 4 }), rule, config, now); assert.equal(messages.length, 1);
  await create().evaluate(sample(10, { successfulSamples: 2 }), rule, config, new Date(now.getTime() + 300000));
  assert.match(messages[1], /queries have recovered/);
});
test("unknown notification delivery remains pending and does not send twice", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() }); let sends = 0;
  const sender = { ready: async () => true, send: async () => { sends++; throw new Error("timeout"); } } as unknown as FeishuClient;
  const alerts = new BalanceAlerts(kv, sender, new IntegrationReceipts(kv));
  const now = new Date("2030-01-01T00:00:00Z");
  await alerts.evaluate(sample(4), rule, defaultBalanceConfig(), now);
  await alerts.evaluate(sample(4), rule, defaultBalanceConfig(), new Date(now.getTime() + 300000));
  assert.equal(sends, 1); assert.equal((await alerts.status("backup")).delivery, "unknown");
});
