import assert from "node:assert/strict";
import test from "node:test";

import type { LlmObservabilityStore } from "../../src/infrastructure/database/llm-observability-store.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { LlmObservabilityRetentionService } from "../../src/services/llm-observability-retention.service.ts";

test("LLM observation retention runs once per day", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = createRetentionStore();
  const service = new LlmObservabilityRetentionService(store, kv);
  const now = new Date("2026-08-25T08:00:00.000Z");
  assert.deepEqual(await service.runDailyCleanupIfDue(now), {
    ran: true,
    observations: 7,
  });
  assert.deepEqual(await service.runDailyCleanupIfDue(now), {
    ran: false,
    observations: 0,
  });
  assert.equal(store.deleteCalls, 1);
  assert.equal(store.lastCutoff, "2026-07-21T08:00:00.000Z");
});

test("LLM observation retention retries after a failed cleanup", async () => {
  const kv = await KVManager.create({ backend: new InMemoryKVBackend() });
  const store = createRetentionStore();
  store.failNext = true;
  const service = new LlmObservabilityRetentionService(store, kv);
  const now = new Date("2026-08-25T08:00:00.000Z");
  await assert.rejects(() => service.runDailyCleanupIfDue(now), /cleanup failed/);
  assert.equal((await service.runDailyCleanupIfDue(now)).ran, true);
  assert.equal(store.deleteCalls, 2);
});

function createRetentionStore() {
  const state = {
    deleteCalls: 0,
    failNext: false,
    lastCutoff: "",
  };
  const store: LlmObservabilityStore & typeof state = {
    ...state,
    async recordObservation() { return true; },
    async getRouteHealth() { return undefined; },
    async queryMetrics() { throw new Error("unused"); },
    async deleteBefore(cutoffIso) {
      store.deleteCalls += 1;
      store.lastCutoff = cutoffIso;
      if (store.failNext) {
        store.failNext = false;
        throw new Error("cleanup failed");
      }
      return { observations: 7 };
    },
  };
  return store;
}
