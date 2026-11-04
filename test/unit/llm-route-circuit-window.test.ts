import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmRouteCircuitBreakerService } from "../../src/services/llm-route-circuit-breaker.service.ts";

const HOUR = 60 * 60 * 1000;
const route = { modelKey: "deepseek-v4-flash", provider: "bai", providerModel: "deepseek-v4.1-flash", operation: "chat" as const };

// Redis expiry and the service's rolling window share a deterministic clock.
class ClockedKVBackend extends InMemoryKVBackend {
  readonly writes: Array<{ key: string; ttl?: number }> = [];
  private readonly expires = new Map<string, number>();
  constructor(private readonly now: () => number) { super(); }
  override async set(key: string, value: string, ttl?: number): Promise<void> {
    this.writes.push({ key, ttl });
    if (ttl) this.expires.set(key, this.now() + ttl * 1000);
    else this.expires.delete(key);
    await super.set(key, value);
  }
  override async get(key: string): Promise<string | null> {
    const expiry = this.expires.get(key);
    if (expiry !== undefined && expiry <= this.now()) return null;
    return super.get(key);
  }
}

async function fixture() {
  let now = Date.parse("2030-01-01T00:00:00Z");
  const start = now;
  const backend = new ClockedKVBackend(() => now);
  const kv = await KVManager.create({ backend });
  const circuit = new LlmRouteCircuitBreakerService(kv, { now: () => new Date(now) });
  return { backend, circuit, at: (hours: number) => { now = start + hours * HOUR; } };
}

test("one user with four sparse pre-chunk failures within 24 hours starts confirmation", async () => {
  const { circuit, at } = await fixture();
  for (const hours of [0, 6, 12]) {
    at(hours);
    assert.equal(await circuit.recordPreFirstChunkFailure(route, "same-user", true, "UPSTREAM_TIMEOUT"), undefined);
  }
  at(23);
  assert.deepEqual(await circuit.recordPreFirstChunkFailure(route, "same-user", true), route);
  const status = await circuit.getRuntimeStatus(route, true);
  assert.equal(status.state, "confirming");
  assert.equal(status.failureCount, 4);
  assert.equal(status.distinctUserCount, 1);
  assert.equal(await circuit.isOpen(route, true), false); // Confirmation still precedes opening.
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, false), "opened");
  assert.equal(await circuit.isOpen(route, true), true);
});

test("failures exactly 24 hours old leave the rolling window", async () => {
  const { circuit, at } = await fixture();
  for (const hours of [0, 1, 2, 24]) {
    at(hours);
    assert.equal(await circuit.recordPreFirstChunkFailure(route, "same-user", true), undefined);
  }
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 3);
  at(24.01);
  assert.ok(await circuit.recordPreFirstChunkFailure(route, "same-user", true));
});

test("closed Redis state survives hourly gaps and expires after the 24 hour window", async () => {
  const { circuit, backend, at } = await fixture();
  for (const hours of [0, 6, 12]) {
    at(hours);
    await circuit.recordPreFirstChunkFailure(route, "same-user", true);
  }
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 3);
  const writes = backend.writes.filter(write =>
    decodeURIComponent(write.key.split(":").at(-1) ?? "").startsWith("route:"),
  );
  assert.equal(writes.length, 3);
  assert.ok(writes.every(write => write.ttl !== undefined && write.ttl >= 24 * 60 * 60));
  at(37);
  await circuit.recordPreFirstChunkFailure(route, "same-user", true);
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 1);
});

test("first effective chunk clears sparse failures and pending confirmation", async () => {
  const { circuit, at } = await fixture();
  for (const hours of [0, 6, 12]) {
    at(hours);
    await circuit.recordPreFirstChunkFailure(route, "same-user", true);
  }
  await circuit.recordFirstEffectiveChunk(route, true);
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 0);
  for (const hours of [13, 14, 15, 16]) {
    at(hours);
    await circuit.recordPreFirstChunkFailure(route, "same-user", true);
  }
  const confirmation = await circuit.claimCircuitConfirmation(route);
  assert.ok(confirmation);
  await circuit.recordFirstEffectiveChunk(route, true);
  assert.equal(await circuit.completeCircuitConfirmation(confirmation, false), "skipped");
  assert.equal((await circuit.getRuntimeStatus(route, true)).state, "closed");
});

test("concurrent single-user failures dispatch only one confirmation", async () => {
  const { circuit } = await fixture();
  const confirmations = await Promise.all(Array.from({ length: 8 }, () =>
    circuit.recordPreFirstChunkFailure(route, "same-user", true),
  ));
  assert.equal(confirmations.filter(Boolean).length, 1);
  assert.equal((await circuit.getRuntimeStatus(route, true)).failureCount, 4);
});

test("admin circuit hint describes 24 hour confirmation without a user quorum", () => {
  const view = readFileSync(new URL("../../apps/admin-web/app/components/llm-config-tab.tsx", import.meta.url), "utf8");
  assert.match(view, /24 小时内累计失败 4 次/);
  assert.match(view, /余额不足 2 次触发后台确认/);
  assert.match(view, /确认探测遇到明确余额不足立即熔断/);
  assert.match(view, /OpenRouter 仅识别 credits 来源/);
  assert.match(view, /排除请求超预算和未知原因/);
  assert.ok(!view.includes("2 分钟内至少 2 位用户"));
});
