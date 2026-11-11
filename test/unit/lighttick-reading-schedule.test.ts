import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
import { ReadingPreferencesService } from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingScheduleService } from "../../src/modules/lighttick/reading/reading-schedule.service.ts";
import { ApplicationError } from "../../src/shared/errors.ts";
import {
  seedReadingRecommendation,
  recommendationFeed,
  recommendationText,
} from "../support/reading-recommendation-fixture.ts";
const owner = { appId: "lighttick" as const, userId: "daily-unit-owner" },
  noModel = {
    complete: async () => {
      throw Error("A daily source job cannot call a model");
    },
  } as any;
async function setup(count = 3) {
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-12T01:59:00Z"),
    full = true,
    phase = 1;
  const clock = () => now,
    work = new ReadingWorkService(repo, queue, async () => {}, clock);
  await seedReadingRecommendation(work, owner, count);
  const preferences = new ReadingPreferencesService(work),
    old = await preferences.read(owner);
  await preferences.save(
    owner,
    {
      base_revision: old.revision,
      value: { ...old.value, enabled: true, hour: 10, minute: 0 },
    },
    "daily-enable-original",
  );
  const authorize = async () => {
      if (!full)
        throw new ApplicationError(
          503,
          "LIGHTTICK_CAPABILITY_UNAVAILABLE",
          "Core pause",
        );
    },
    schedule = new ReadingScheduleService(work, authorize);
  const runner = new ReadingWorkRunner(
    work,
    noModel,
    async (url) =>
      url.endsWith("/feed")
        ? { body: recommendationFeed(4), content_type: "application/rss+xml" }
        : {
            body:
              phase === 1 && !url.endsWith("article-0")
                ? "short excerpt"
                : recommendationText,
            content_type: "text/plain",
          },
    authorize,
  );
  return {
    repo,
    work,
    preferences,
    schedule,
    runner,
    setNow: (value: string) => (now = new Date(value)),
    setFull: (value: boolean) => (full = value),
    setPhase: (value: number) => (phase = value),
  };
}
test("Shanghai opt-in scheduling is due once, survives duplicate scans, imports partial full text and retries only the remaining daily goal after15min", async () => {
  const f = await setup();
  assert.deepEqual(await f.schedule.scan(), {
    checked: 0,
    created: 0,
    failed: 0,
  });
  assert.equal((await f.schedule.read(owner)).day, null);
  f.setNow("2026-11-12T02:00:00Z");
  assert.equal((await f.schedule.scan()).created, 1);
  let day = (await f.schedule.read(owner)).day!;
  assert.equal(day.attempts, 1);
  assert.equal(day.preferences_revision, 2);
  const first = day.work_id!;
  assert.equal((await f.schedule.scan()).created, 0);
  await f.runner.execute(owner, first);
  await f.schedule.scan();
  day = (await f.schedule.read(owner)).day!;
  assert.equal(day.adopted.length, 1);
  assert.equal(day.work_id, null);
  assert.equal(day.next_at, "2026-11-12T02:15:00.000Z");
  assert.equal((await f.preferences.read(owner)).revision, 2);
  f.setNow("2026-11-12T02:14:59Z");
  assert.equal((await f.schedule.scan()).created, 0);
  f.setNow("2026-11-12T02:15:00Z");
  f.setPhase(2);
  assert.equal((await f.schedule.scan()).created, 1);
  day = (await f.schedule.read(owner)).day!;
  const second = await f.work.store.get(owner, day.work_id!);
  assert.equal(second!.input.recommendation!.target_count, 2);
  assert.equal(second!.input.recommendation!.scope.preferences.value.count, 3);
  await f.runner.execute(owner, day.work_id!);
  await f.schedule.scan();
  day = (await f.schedule.read(owner)).day!;
  assert.equal(day.phase, "complete");
  assert.equal(day.attempts, 2);
  assert.equal(day.adopted.length, 3);
  assert.equal(new Set(day.adopted.map((a) => a.article_id)).size, 3);
  assert.equal((await f.schedule.scan()).created, 0);
  const articles = await f.repo.reading.list(owner, {
    search: "",
    filter: "all",
    after: "",
    limit: 50,
  });
  assert.equal(articles.length, 3);
  assert.ok(articles.every((a) => !a.personal.read && !a.personal.read_at));
  assert.equal((await f.preferences.history(owner)).items.length, 2);
});
test("core pauses queued daily work; stopping the day atomically cancels its active work and replays the original stop receipt", async () => {
  const f = await setup(1);
  f.setNow("2026-11-12T02:00:00Z");
  await f.schedule.scan();
  const day = (await f.schedule.read(owner)).day!,
    id = day.work_id!;
  f.setFull(false);
  await f.runner.execute(owner, id);
  assert.equal((await f.work.read(owner, id)).status, "queued");
  assert.equal((await f.schedule.scan()).created, 0);
  const body = { base_revision: day.revision },
    stopped = await f.schedule.stop(
      owner,
      day.date,
      body,
      "daily-stop-original",
    );
  assert.equal(stopped.phase, "stopped");
  assert.equal((await f.work.read(owner, id)).status, "cancelled");
  assert.deepEqual(
    await f.schedule.stop(owner, day.date, body, "daily-stop-original"),
    stopped,
  );
  f.setFull(true);
  await f.runner.execute(owner, id);
  assert.equal((await f.schedule.scan()).created, 0);
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 0);
  await assert.rejects(
    f.schedule.stop(
      { ...owner, userId: "other" },
      day.date,
      body,
      "daily-stop-other",
    ),
    { statusCode: 404 },
  );
});
test("a completed download is not auto-adopted after preferences change, and an automatic prior-date task cannot publish after midnight", async () => {
  const f = await setup(1);
  f.setNow("2026-11-12T02:00:00Z");
  await f.schedule.scan();
  let day = (await f.schedule.read(owner)).day!;
  await f.runner.execute(owner, day.work_id!);
  const prefs = await f.preferences.read(owner);
  await f.preferences.save(
    owner,
    {
      base_revision: prefs.revision,
      value: { ...prefs.value, query: "changed intent" },
    },
    "daily-change-preferences",
  );
  await f.schedule.scan();
  day = (await f.schedule.read(owner)).day!;
  assert.equal(day.phase, "stopped");
  assert.equal(day.error_code, "PREFERENCES_CHANGED");
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 0);
  const second = await setup(1);
  second.setNow("2026-11-12T15:59:00Z");
  await second.schedule.scan();
  const prior = (await second.schedule.read(owner)).day!;
  second.setNow("2026-11-12T16:01:00Z");
  await second.runner.execute(owner, prior.work_id!);
  const failed = await second.work.read(owner, prior.work_id!);
  assert.equal(failed.status, "failed");
  assert.equal(failed.error_code, "READING_CONTEXT_STALE");
  assert.equal(
    (await second.schedule.read(owner, prior.date)).day!.expired,
    true,
  );
  assert.equal(
    (await second.repo.reading.recommendationHistory(owner)).length,
    0,
  );
});
test("manual same-URL facts are skipped rather than relabelled as adoption of a different daily result, and receipt failures roll back daily state", async () => {
  const f = await setup(1);
  f.setNow("2026-11-12T02:00:00Z");
  await f.schedule.scan();
  let day = (await f.schedule.read(owner)).day!;
  await f.runner.execute(owner, day.work_id!);
  const row = await f.work.read(owner, day.work_id!),
    content = row.output!.entry_refs![0].content;
  const { ReadingService } = await import(
    "../../src/modules/lighttick/reading/reading.service.ts"
  );
  await new ReadingService(f.repo).write(
    owner,
    "article-manual-race",
    "import",
    {
      base_revision: 0,
      content: {
        ...content,
        body: "User independently saved another immutable version.",
      },
    },
    "daily-manual-race",
  );
  await f.schedule.scan();
  day = (await f.schedule.read(owner)).day!;
  assert.equal(day.adopted.length, 0);
  assert.equal(day.skipped.length, 1);
  assert.equal((await f.work.read(owner, row.id)).adopted["0"], undefined);
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 1);
  const second = await setup(1);
  second.setNow("2026-11-12T02:00:00Z");
  await second.schedule.scan();
  const pending = (await second.schedule.read(owner)).day!;
  await second.runner.execute(owner, pending.work_id!);
  const save = second.repo.saveOperation.bind(second.repo);
  second.repo.saveOperation = async (row) => {
    if (row.action === "work:adopt")
      throw Error("Injected daily receipt failure");
    return save(row);
  };
  await assert.rejects(
    second.schedule.advance(owner, pending.date),
    /Injected/,
  );
  assert.equal(
    (await second.repo.reading.recommendationHistory(owner)).length,
    0,
  );
  assert.equal(
    (await second.schedule.read(owner)).day!.revision,
    pending.revision,
  );
  assert.deepEqual(
    (await second.work.read(owner, pending.work_id!)).adopted,
    {},
  );
});

test("failed source discovery retries at most twice, respects cooldown and never backfills another business date", async () => {
  const f = await setup(8);
  f.setNow("2026-11-12T02:00:00Z");
  let calls = 0;
  const runner = new ReadingWorkRunner(f.work, noModel, async () => {
    calls++;
    throw Error("Fixture source unavailable");
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal((await f.schedule.scan()).created, 1);
    const day = (await f.schedule.read(owner)).day!;
    assert.equal(day.attempts, attempt + 1);
    await runner.execute(owner, day.work_id!);
    await f.schedule.scan();
    assert.equal((await f.schedule.scan()).created, 0);
    if (attempt < 2)
      f.setNow(
        "2026-11-12T02:" + String((attempt + 1) * 15).padStart(2, "0") + ":00Z",
      );
  }
  const done = (await f.schedule.read(owner)).day!;
  assert.equal(done.phase, "complete");
  assert.equal(done.error_code, "INSUFFICIENT_READABLE_FULL_TEXT");
  assert.equal(done.attempts, 3);
  assert.equal(calls, 3);
  assert.equal(done.adopted.length, 0);
  f.setNow("2026-11-14T02:00:00Z");
  assert.equal((await f.schedule.scan()).created, 1);
  assert.equal((await f.schedule.read(owner, "2026-11-13")).day, null);
  assert.equal((await f.schedule.history(owner)).items.length, 2);
});
test("quota delays do not consume a daily source attempt and lost queue delivery recovers the same day/work identity", async () => {
  const f = await setup(1);
  f.setNow("2026-11-12T02:00:00Z");
  const first = await f.work.create(
    owner,
    { kind: "collect_url", title: "One", url: "https://example.com/one" },
    "daily-capacity-one",
  );
  await f.work.create(
    owner,
    { kind: "collect_url", title: "Two", url: "https://example.com/two" },
    "daily-capacity-two",
  );
  await f.schedule.scan();
  let day = (await f.schedule.read(owner)).day!;
  assert.equal(day.attempts, 0);
  assert.equal(day.error_code, "PENDING_READING_WORK");
  await f.work.cancel(
    owner,
    first.id,
    { base_revision: first.revision },
    "daily-free-slot",
  );
  f.setNow("2026-11-12T02:01:00Z");
  const original = f.work.queue.add.bind(f.work.queue);
  f.work.queue.add = async () => {
    throw Error("Queue unavailable");
  };
  await f.schedule.scan();
  day = (await f.schedule.read(owner)).day!;
  assert.equal(day.attempts, 1);
  const id = day.work_id!;
  assert.equal((await f.work.read(owner, id)).error_code, "QUEUE_UNAVAILABLE");
  f.work.queue.add = original;
  await f.runner.recover();
  assert.equal((await f.schedule.read(owner)).day!.work_id, id);
  assert.equal((await f.schedule.read(owner)).day!.attempts, 1);
  assert.equal((await f.work.read(owner, id)).status, "queued");
});
test("a changed source blocks automatic adoption while retaining the original downloaded result for explicit review", async () => {
  const f = await setup(1);
  f.setNow("2026-11-12T02:00:00Z");
  await f.schedule.scan();
  const pending = (await f.schedule.read(owner)).day!;
  await f.runner.execute(owner, pending.work_id!);
  await f.work.deleteSource(
    owner,
    "source-batch-fixture",
    { base_revision: 1 },
    "daily-delete-source",
  );
  await f.schedule.scan();
  const done = (await f.schedule.read(owner)).day!;
  assert.equal(done.phase, "stopped");
  assert.equal(done.error_code, "READING_CONTEXT_STALE");
  assert.equal((await f.repo.reading.recommendationHistory(owner)).length, 0);
  assert.equal(
    (await f.work.read(owner, pending.work_id!)).status,
    "succeeded",
  );
});

test("future automatic shutdown preserves removed source choices and every other saved field instead of requiring configuration repair", async () => {
  const f = await setup(1),
    before = await f.preferences.read(owner);
  await f.work.deleteSource(
    owner,
    "source-batch-fixture",
    { base_revision: 1 },
    "daily-remove-before-disable",
  );
  const body = { base_revision: before.revision },
    disabled = await f.preferences.disable(
      owner,
      body,
      "daily-disable-future-original",
    );
  assert.equal(disabled.value.enabled, false);
  assert.deepEqual(disabled.value, { ...before.value, enabled: false });
  assert.deepEqual(
    await f.preferences.disable(owner, body, "daily-disable-future-original"),
    disabled,
  );
  f.setNow("2026-11-12T02:00:00Z");
  assert.equal((await f.schedule.scan()).created, 0);
  assert.equal((await f.schedule.read(owner)).day, null);
});
