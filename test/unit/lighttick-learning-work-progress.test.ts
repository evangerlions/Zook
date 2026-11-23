import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "learning-progress-synthetic" };
const routeId = "plan-learning-progress";

function setup(complete: (input: any) => Promise<any>) {
  const now = new Date("2026-11-04T08:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repo, true, () => now),
    routes = new LearningRouteService(native),
    work = new LearningWorkService(routes, queue);
  const llm = { complete } as any;
  const runner = new LearningWorkRunner(work, llm, {
    readFile: async () => {
      throw Error("Unavailable owner file");
    },
    fetchUrl: async () => {
      throw Error("Unexpected external fetch");
    },
  });
  return { repo, queue, native, routes, work, runner, llm };
}

const request = () => ({
  kind: "route_draft",
  route_id: routeId,
  base_revision: 0,
  brief: routeFixture().brief,
});

function signal() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

const ok = () => ({
  text: JSON.stringify(routeFixture().document),
  provider: "synthetic",
  providerModel: "fixture",
});

test("progress reports the model phase without bumping the work revision", async () => {
  const started = signal(),
    release = signal();
  const f = setup(async () => {
    started.resolve();
    await release.promise;
    return ok();
  });
  const created = await f.work.create(owner, request(), "progress-hold");
  assert.equal((await f.work.read(owner, created.id)).progress, null);

  const running = f.runner.execute(owner, created.id);
  await started.promise;

  const mid = await f.work.store.get(owner, created.id);
  assert.equal(mid!.progress!.phase, "calling_model");
  assert.equal(mid!.revision, 2, "progress must not bump the CAS revision");

  const cancelled = await f.work.cancel(
    owner,
    created.id,
    { base_revision: mid!.revision },
    "progress-cancel",
  );
  assert.equal(cancelled.status, "cancelled");

  release.resolve();
  await running;
});

test("a stale fence cannot overwrite progress", async () => {
  const started = signal(),
    release = signal();
  const f = setup(async () => {
    started.resolve();
    await release.promise;
    return ok();
  });
  const created = await f.work.create(owner, request(), "progress-stale-fence");
  const running = f.runner.execute(owner, created.id);
  await started.promise;

  await f.work.store.progress(owner, created.id, "not-the-fence", {
    phase: "validating",
    received_chars: 999,
    lesson_count_so_far: 9,
    updated_at: new Date().toISOString(),
  });

  const mid = await f.work.store.get(owner, created.id);
  assert.equal(mid!.progress!.phase, "calling_model");
  assert.equal(mid!.progress!.received_chars, 0);

  release.resolve();
  await running;
});

test("terminal progress records the phase, character count and lesson count", async () => {
  const f = setup(async () => ok());
  const created = await f.work.create(owner, request(), "progress-done");
  await f.runner.execute(owner, created.id);

  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "succeeded");
  const progress = (done as any).progress;
  assert.equal(progress.phase, "done");
  assert.equal(progress.received_chars, JSON.stringify(routeFixture().document).length);
  assert.equal(progress.lesson_count_so_far, routeFixture().document.lessons.length);
});

test("failed work reports the failed phase", async () => {
  const f = setup(async () => ({
    text: JSON.stringify({ ...routeFixture().document, lessons: [] }),
    provider: "synthetic",
    providerModel: "fixture",
  }));
  const created = await f.work.create(owner, request(), "progress-failed");
  await f.runner.execute(owner, created.id);

  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "failed");
  assert.equal((done as any).progress.phase, "failed");
  assert.equal(done.output, null);
});
