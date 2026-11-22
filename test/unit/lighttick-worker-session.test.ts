import test from "node:test";
import assert from "node:assert/strict";
import {
  createLightTickWorkerSession,
  launchReadingWork,
  drainLightTickWorkerSession,
} from "../../src/modules/lighttick/lighttick-worker-session.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { DeferJobError } from "../../src/infrastructure/queue/job-queue.ts";
test("reading work retains a bounded caller-owned session while other products continue through the same durable queue", async () => {
  const queue = new InMemoryJobQueue(),
    session = createLightTickWorkerSession();
  let finish!: () => void,
    started = 0,
    other = 0;
  const blocked = new Promise<void>((resolve) => (finish = resolve));
  await queue.add(
    "lighttick.reading.work",
    { user: "first" },
    { jobId: "reading-first", attempts: 1 },
  );
  await queue.add(
    "other.notification",
    {},
    { jobId: "other-job", attempts: 1 },
  );
  await queue.add(
    "lighttick.reading.work",
    { user: "second" },
    { jobId: "reading-second", attempts: 1 },
  );
  await queue.processDueJobs(async (job) => {
    if (job.name === "other.notification") {
      other++;
      return;
    }
    launchReadingWork(
      session,
      job.id,
      async () => {
        started++;
        await blocked;
      },
      async () => {},
    );
  });
  assert.equal(other, 1);
  assert.equal(started, 1);
  assert.equal(session.reading.size, 1);
  assert.equal(queue.jobs.length, 1);
  assert.equal(queue.jobs[0].id, "reading-second");
  assert.equal(queue.jobs[0].attemptsMade, 0);
  finish();
  await drainLightTickWorkerSession(session);
  assert.equal(session.reading.size, 0);
  await queue.processDueJobs(
    (job) =>
      launchReadingWork(
        session,
        job.id,
        async () => {
          started++;
        },
        async () => {},
      ),
    new Date(Date.now() + 2000),
  );
  await drainLightTickWorkerSession(session);
  assert.equal(started, 2);
  assert.equal(queue.jobs.length, 0);
});
test("a duplicate delivery cannot launch the same live work and terminal persistence failures do not become unhandled promises", async () => {
  const reported: string[] = [],
    session = createLightTickWorkerSession((key) => reported.push(key));
  let finish!: () => void,
    starts = 0;
  const waiting = new Promise<void>((resolve) => (finish = resolve));
  launchReadingWork(
    session,
    "same",
    async () => {
      starts++;
      await waiting;
    },
    async () => {},
  );
  launchReadingWork(
    session,
    "same",
    async () => {
      starts++;
    },
    async () => {},
  );
  assert.throws(
    () =>
      launchReadingWork(
        session,
        "different",
        async () => {},
        async () => {},
      ),
    DeferJobError,
  );
  finish();
  await drainLightTickWorkerSession(session);
  assert.equal(starts, 1);
  launchReadingWork(
    session,
    "failed",
    async () => {
      throw Error("synthetic persistence unavailable");
    },
    async () => {
      throw Error("terminal journal also unavailable");
    },
  );
  await drainLightTickWorkerSession(session);
  assert.deepEqual(reported, ["failed"]);
  assert.equal(session.reading.size, 0);
});
test("shared-worker session dispatch keeps core deferral and registered reading ownership validation while direct callers can await completion", async () => {
  let released!: () => void,
    completed = 0;
  const waiting = new Promise<void>((resolve) => (released = resolve)),
    reading = {
      execute: async () => {
        await waiting;
        completed++;
      },
    },
    session = createLightTickWorkerSession();
  const worker = new LightTickWorker(
      {} as any,
      async () => {},
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => "full",
      reading as any,
    ),
    job = {
      id: "reading-original",
      name: "lighttick.reading.work",
      payload: {
        app_id: "lighttick",
        user_id: "owner",
        work_id: "readwork-owner",
      },
      attemptsMade: 0,
      maxAttempts: 1,
      backoffMs: 1000,
      availableAt: new Date().toISOString(),
    };
  await worker.process(job, session);
  assert.equal(completed, 0);
  assert.equal(session.reading.size, 1);
  await assert.rejects(
    worker.process(
      { ...job, payload: { ...job.payload, app_id: "other" } },
      session,
    ),
  );
  released();
  await drainLightTickWorkerSession(session);
  assert.equal(completed, 1);
  const core = new LightTickWorker(
    {} as any,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    async () => "core",
    reading as any,
  );
  await assert.rejects(core.process(job, session), DeferJobError);
  assert.equal(session.reading.size, 0);
});
