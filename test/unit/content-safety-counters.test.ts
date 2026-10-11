import assert from "node:assert/strict";
import test from "node:test";
import { KVManager, InMemoryKVBackend } from "../../src/infrastructure/kv/kv-manager.ts";
import { ContentSafetyCounters } from "../../src/services/content-safety-counters.ts";
import type { ContentSafetyConfig } from "../../src/shared/types.ts";

const now = () => new Date("2026-10-09T00:00:00Z");
const config = { llm: { modelKey: "qwen3.6-flash" } } as ContentSafetyConfig;
const command = { appId: "test", text: "private text", statsDate: "2026-10-09" };

test("parallel counters preserve totals, categories and models without storing text", async () => {
  const backend = new InMemoryKVBackend();
  const counters = new ContentSafetyCounters(await KVManager.create({ backend }), undefined, now);
  await Promise.all(Array.from({ length: 1000 }, async (_, i) => {
    await counters.started(command);
    await counters.completed(command, { ...config, llm: { ...config.llm, useJev: i % 2 === 0 } }, {
      text: command.text, method: "llm", decision: i % 5 === 0 ? "failed_open" : i % 2 === 0 ? "block" : "pass",
      category: "violence_crime",
    });
  }));
  const stats = await counters.getStats({});
  assert.deepEqual(stats.summary, {
    total: 1000, successful: 800, passed: 400, blocked: 400, failedOpen: 200, blockRate: 0.4, failedOpenRate: 0.2,
  });
  assert.equal(stats.byCategory[0].count, 400);
  assert.deepEqual(stats.byModel.map(item => [item.key, item.count]).sort(), [["jev", 500], ["qwen", 500]]);
  const raw = await backend.getCounters("kv:content-safety-counters-v1:2026-10-09");
  assert.equal(raw.total, 1000);
  assert.ok(!JSON.stringify(raw).includes(command.text));
});

test("in-flight requests and midnight completion stay in the start-day bucket", async () => {
  let date = new Date("2026-10-08T15:59:59Z");
  const counters = new ContentSafetyCounters(await KVManager.create({ backend: new InMemoryKVBackend() }), undefined, () => date);
  const started = { ...command, statsDate: "2026-10-08" };
  await counters.started(started);
  assert.equal((await counters.getStats({})).summary.successful, 0);
  date = new Date("2026-10-08T16:00:01Z");
  await counters.completed(started, config, { method: "llm", decision: "pass", text: "text" });
  const stats = await counters.getStats({ dateFrom: "2026-10-08", dateTo: "2026-10-09" });
  assert.deepEqual(stats.daily.map(item => [item.date, item.total, item.successful]), [["2026-10-08", 1, 1], ["2026-10-09", 0, 0]]);
});

test("statistics read at most thirty hashes, validate dates and reject removed dimensions", async () => {
  const backend = new InMemoryKVBackend();
  let reads = 0;
  backend.getCounters = async () => { reads++; return {}; };
  const counters = new ContentSafetyCounters(await KVManager.create({ backend }), undefined, now);
  assert.equal((await counters.getStats({ dateFrom: "2000-01-01", dateTo: "2099-01-01" })).daily.length, 30);
  assert.equal(reads, 30);
  for (const filter of [{ source: "business" }, { dateFrom: "2026-02-30" }, { dateTo: "invalid" }]) {
    await assert.rejects(counters.getStats(filter), { code: "REQ_INVALID_QUERY" });
  }
});

test("counter outages cannot change decisions and warnings are rate-limited", async () => {
  const backend = new InMemoryKVBackend();
  backend.incrementCounters = async () => { throw new Error("redis unavailable"); };
  let warnings = 0;
  const logger = { warn: () => { warnings++; } } as any;
  const counters = new ContentSafetyCounters(await KVManager.create({ backend }), logger, now);
  await counters.started(command);
  await counters.completed(command, config, { method: "llm", decision: "block", text: "text" });
  assert.equal(warnings, 1);
  backend.incrementCounters = () => new Promise(() => {});
  const start = Date.now();
  await counters.started(command);
  assert.ok(Date.now() - start < 1000);
});

test("daily hashes expire after thirty-five days", async () => {
  const backend = new InMemoryKVBackend();
  let ttl = 0;
  backend.incrementCounters = async (_key, _fields, seconds) => { ttl = seconds; };
  const counters = new ContentSafetyCounters(await KVManager.create({ backend }), undefined, now);
  await counters.started(command);
  assert.equal(ttl, 35 * 86400);
});
