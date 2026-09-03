import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickJobService, LightTickWorker, nextLightTickLocalSchedule } from "../../src/modules/lighttick/lighttick-worker.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "worker_user" };

test("job creation is stable across repeated scheduler ticks", async () => {
  const queue = new InMemoryJobQueue(); const repository = new InMemoryLightTickRepository();
  const jobs = new LightTickJobService(queue, repository, () => new Date("2026-08-20T00:00:00Z"));
  const first = await jobs.enqueueNotification(owner, "daily_tasks", "2026-08-20");
  const duplicate = await jobs.enqueueNotification(owner, "daily_tasks", "2026-08-20");
  assert.deepEqual(duplicate, first); assert.equal(queue.jobs.length, 1);
  await jobs.enqueueAggregation(owner, "2026-08-20"); assert.equal(queue.jobs.length, 2);
});

test("worker reloads stable IDs, retries crashes, and records terminal failure before DLQ", async () => {
  const queue = new InMemoryJobQueue(); const failures: string[] = [];
  const runner = { execute: async () => { throw new Error("provider offline"); } };
  const worker = new LightTickWorker(runner as any, async job => { failures.push(job.id); });
  await queue.add("lighttick.ai.run", { user_id: owner.userId, run_id: "run_12345678", scene: "week_plan" }, { attempts: 2, backoffMs: 1 });
  await queue.processDueJobs(job => worker.process(job), new Date("2030-01-01T00:00:00Z"));
  assert.equal(queue.jobs[0]?.attemptsMade, 1); assert.equal(failures.length, 0);
  await queue.processDueJobs(job => worker.process(job), new Date("2030-01-01T00:00:01Z"));
  assert.equal(queue.deadLetterQueue.length, 1); assert.equal(failures.length, 1);
});

test("timezone scheduling derives the next local wall-clock occurrence", () => {
  assert.equal(nextLightTickLocalSchedule(new Date("2026-08-20T00:00:00Z"), "Asia/Shanghai", 9).toISOString(), "2026-08-20T01:00:00.000Z");
  assert.equal(nextLightTickLocalSchedule(new Date("2026-08-20T02:00:00Z"), "Asia/Shanghai", 9).toISOString(), "2026-08-21T01:00:00.000Z");
  assert.equal(nextLightTickLocalSchedule(new Date("2026-11-01T05:00:00Z"), "America/New_York", 9).toISOString(), "2026-11-01T14:00:00.000Z");
});
