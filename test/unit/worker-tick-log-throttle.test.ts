import assert from "node:assert/strict";
import test from "node:test";
import { WorkerTickLogThrottle } from "../../src/services/worker-tick-log-throttle.ts";

test("worker tick log throttle emits successful failed-events-replay logs at most once every 20 minutes", () => {
  let now = 1_000;
  const throttle = new WorkerTickLogThrottle({
    now: () => now,
  });

  const context = {
    jobName: "failed-events-replay",
    jobId: "scheduler",
    statusCode: 200,
    smsCleanupRan: false,
    smsCleanupDeleted: 0,
  };

  assert.equal(throttle.shouldLog(context), true);

  now += 5 * 60 * 1000;
  assert.equal(throttle.shouldLog(context), false);

  now += 20 * 60 * 1000;
  assert.equal(throttle.shouldLog(context), true);
});

test("worker tick log throttle does not suppress failed-events-replay logs that carry an error signal", () => {
  let now = 1_000;
  const throttle = new WorkerTickLogThrottle({
    now: () => now,
  });

  const context = {
    jobName: "failed-events-replay",
    jobId: "scheduler",
    statusCode: 200,
    error: "remaining=2",
  };

  assert.equal(throttle.shouldLog(context), true);
  now += 10 * 1000;
  assert.equal(throttle.shouldLog(context), true);
});

test("worker tick log throttle does not suppress unrelated worker logs", () => {
  const throttle = new WorkerTickLogThrottle();

  assert.equal(
    throttle.shouldLog({
      jobName: "bootstrap",
      jobId: "worker",
      statusCode: 200,
    }),
    true,
  );
});
