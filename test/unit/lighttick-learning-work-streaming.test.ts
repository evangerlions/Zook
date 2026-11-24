import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "learning-stream-synthetic" };
const routeId = "plan-learning-stream";
const document = routeFixture().document;
const fullText = () => JSON.stringify(document);

function setup(llm: any) {
  const now = new Date("2026-11-04T08:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repo, true, () => now),
    routes = new LearningRouteService(native),
    work = new LearningWorkService(routes, queue);
  const runner = new LearningWorkRunner(work, llm, {
    readFile: async () => {
      throw Error("Unavailable owner file");
    },
    fetchUrl: async () => {
      throw Error("Unexpected external fetch");
    },
  });
  return { repo, queue, native, routes, work, runner };
}

const request = (extra: Record<string, unknown> = {}) => ({
  kind: "route_draft",
  route_id: routeId,
  base_revision: 0,
  brief: routeFixture().brief,
  ...extra,
});

function gate() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>((r) => {
    resolve = r;
  });
  return { resolve, promise };
}

/** Poll instead of guessing how many microtasks a coalesced write needs. */
async function until(check: () => Promise<boolean>, label: string, ms = 3000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw Error("timed out waiting for " + label);
}

test("streaming reports live character and lesson progress before completion", async () => {
  const text = fullText(),
    firstLessonEnd = text.indexOf('"kind":"review"');
  assert.ok(firstLessonEnd > 0, "fixture must have a second lesson to split on");
  const head = text.slice(0, firstLessonEnd),
    tail = text.slice(firstLessonEnd),
    reachedMid = gate(),
    releaseMid = gate();
  const llm = {
    complete: async () => {
      throw Error("buffered completion must not run when streaming is available");
    },
    completeViaStream: async (_request: any, options: any) => {
      options?.onContentDelta?.(head, head);
      reachedMid.resolve();
      await releaseMid.promise;
      options?.onContentDelta?.(tail, head + tail);
      return { text: head + tail, provider: "synthetic", providerModel: "fixture" };
    },
  };
  const f = setup(llm);
  const created = await f.work.create(owner, request(), "stream-live-progress");
  const running = f.runner.execute(owner, created.id);
  await reachedMid.promise;

  await until(
    async () =>
      (await f.work.store.get(owner, created.id))?.progress?.lesson_count_so_far === 1,
    "the first lesson to be counted mid-stream",
  );
  const mid = await f.work.store.get(owner, created.id);
  assert.equal(mid!.status, "running");
  assert.equal(mid!.progress!.phase, "calling_model");
  assert.equal(mid!.progress!.received_chars, head.length);
  assert.equal(mid!.progress!.lesson_count_so_far, 1);

  releaseMid.resolve();
  await running;

  const done = await f.work.read(owner, created.id);
  assert.equal(done.status, "succeeded");
  assert.equal((done as any).progress.phase, "done");
  assert.equal((done as any).progress.received_chars, text.length);
  assert.equal((done as any).progress.lesson_count_so_far, 2);
});

test("a model without the streaming capability still produces the same result", async () => {
  let calls = 0;
  const llm = {
    complete: async () => {
      calls++;
      return { text: fullText(), provider: "synthetic", providerModel: "fixture" };
    },
  };
  const f = setup(llm);
  const created = await f.work.create(owner, request(), "stream-absent");
  await f.runner.execute(owner, created.id);

  const done = await f.work.read(owner, created.id);
  assert.equal(calls, 1);
  assert.equal(done.status, "succeeded");
  assert.deepEqual((done.output as any).document, document);
  assert.equal((done as any).progress.phase, "done");
});

test("a mid-stream failure is reported and retried rather than silently succeeding", async () => {
  const text = fullText(),
    head = text.slice(0, text.indexOf('"kind":"review"'));
  const llm = {
    complete: async () => {
      throw Error("buffered completion must not run when streaming is available");
    },
    completeViaStream: async (_request: any, options: any) => {
      options?.onContentDelta?.(head, head);
      throw Error("provider dropped the connection");
    },
  };
  const f = setup(llm);
  const created = await f.work.create(owner, request(), "stream-failure");
  await f.runner.execute(owner, created.id);

  const done = await f.work.read(owner, created.id);
  // Partial text is never published as a draft, and the platform path is retried
  // under the existing rule instead of being treated as a success.
  assert.equal(done.output, null);
  assert.equal(done.error_code, "LEARNING_PROVIDER_UNAVAILABLE");
  assert.equal(done.status, "queued");
  assert.equal((done as any).progress.phase, "failed");
  assert.equal(done.attempt, 1);
});
