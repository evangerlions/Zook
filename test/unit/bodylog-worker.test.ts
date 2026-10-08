import assert from "node:assert/strict";
import test from "node:test";
import { BodyLogWorkerService } from "../../src/modules/bodylog/bodylog-worker.service.ts";

test("daily BodyLog worker runs the inactive-buddy sweep once per UTC day", async () => {
  const completed = new Set<string>();
  const calls = { buddy: 0, inactive: 0, group: 0, weekly: 0 };
  const jobs = {
    runOnce: async (key: string, job: () => Promise<void>) => {
      if (completed.has(key)) return false;
      await job();
      completed.add(key);
      return true;
    },
  };
  const buddy = {
    dailySettlement: async () => { calls.buddy++; },
    autoDissolveInactivePairs: async () => { calls.inactive++; },
  };
  const group = {
    dailySettlement: async () => { calls.group++; },
    weeklySettlement: async () => { calls.weekly++; },
  };
  const logger = { info() {}, error() {} };
  const worker = new BodyLogWorkerService(jobs, buddy as never, group as never, logger as never);

  const first = await worker.processBatch();
  const second = await worker.processBatch();

  assert.equal(first.inactiveBuddyPairs, true);
  assert.equal(second.inactiveBuddyPairs, false);
  assert.equal(calls.buddy, 1);
  assert.equal(calls.inactive, 1);
  assert.equal(calls.group, 1);
  assert.ok(calls.weekly === 0 || calls.weekly === 1);
});
