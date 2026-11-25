import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { decodeCursor, type LightTickSearchResult, type LightTickTimelinePage } from "../../src/modules/lighttick/lighttick-search.service.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { createApplication } from "../support/create-test-application.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("A disposable local LightTick test database is required.");

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const other = { ...owner, userId: "user_bob" } as const;
const now = "2026-11-23T08:00:00.000Z";
const tiedTimestamp = "2026-11-23T08:00:00.123456Z";
const clock = () => new Date(now);
const recordId = "record-search-privacy";
const lessonSource = {
  route_id: "plan-search-privacy", route_version: 1, lesson_number: 1, lesson_id: "lesson-search-privacy",
  content_version: "a".repeat(64), purpose: "review",
};

async function createTasks(repository: PostgresLightTickRepository, taskOwner: LightTickOwner, titles: string[]) {
  const goal = await new LightTickGoalService(repository, clock).create(taskOwner, { title: "Review progress", constraints: {} });
  const plans = new LightTickPlanService(repository, clock);
  const draft = await plans.createProposed(taskOwner, {
    goalId: goal.id, source: "template", granularity: "week", periodStart: "2026-11-23", periodEnd: "2026-11-29",
    tasks: titles.map(title => ({ title, estimatedMinutes: 10, scheduledFor: "2026-11-23" })),
  });
  return { goal, tasks: (await plans.confirm(taskOwner, draft.id, draft.version)).tasks };
}

test("search/timeline exclude hidden lesson tasks before paging, across owners and after revocation", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const repository = new PostgresLightTickRepository(pool);
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const taskOwner of [owner, other])
    seed.appUsers.push({ ...taskOwner, id: "search-privacy-" + taskOwner.userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now });
  const application = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repository });
  const read = async <T>(endpoint: string, query: Record<string, string> = {}, taskOwner: LightTickOwner = owner) => {
    const result = await application.app.handle({
      method: "GET", path: "/api/v1/lighttick/" + endpoint, query,
      headers: {
        authorization: "Bearer " + application.services.tokenService.issueAccessToken(taskOwner.userId, taskOwner.appId),
        "x-app-id": taskOwner.appId, "x-lighttick-task-schema": "2",
      },
    });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    assert.equal(result.headers?.["Cache-Control"], "no-store");
    return result.body.data as T;
  };
  const search = (q: string, scope: "task" | "record", limit = "1", taskOwner: LightTickOwner = owner) =>
    read<LightTickSearchResult>("search", { q, scope, limit }, taskOwner);
  const timeline = (cursor?: string) => read<LightTickTimelinePage>("timeline", { limit: "1", ...(cursor ? { cursor } : {}) });
  const pages = async (startCursor?: string) => {
    let cursor = startCursor;
    const ids: string[] = [];
    for (let i = 0; i < 8; i++) {
      const page = await timeline(cursor);
      ids.push(...page.items.map(item => item.id));
      if (!page.next_cursor) return ids;
      assert.notEqual(page.next_cursor, cursor);
      cursor = page.next_cursor;
    }
    assert.fail("Unexpected Timeline cursor loop");
  };
  const authority = {
    ...owner, phase: "legacy", module: "learning", readingEnabled: true, privateEnabled: false, epoch: 1, revision: 1,
    manifestHash: null, sourceBinding: null, updatedAt: now,
  } as const;
  try {
    const recordService = new LightTickRecordService(repository, clock);
    const uniqueReview = "把依赖标记为 REVIEW%_abc 后每周复查";
    const { goal, tasks: [first, second, older, lesson, secondLesson] } = await createTasks(repository, owner,
      ["First paging target", "Second paging target", "Older ordinary task", "Authorized lesson result", "Another lesson result"]);
    const { tasks: [otherTask] } = await createTasks(repository, other, ["Other owner's task"]);
    await recordService.mutate(owner, recordId, "save",
      { raw_text: "Independent paging target", record_date: "2026-11-23", base_version: 0,
        guided_answers: { work_reflection_takeaway: "本次明确了依赖", work_reflection_next_step: uniqueReview } }, "record-search-privacy-save");
    await pool.query("UPDATE zook_lighttick_records SET updated_at=$1 WHERE app_id=$2 AND user_id=$3 AND id=$4",
      [tiedTimestamp, owner.appId, owner.userId, recordId]);
    await pool.query("UPDATE zook_lighttick_goals SET updated_at=$1 WHERE app_id=$2 AND user_id=$3 AND id=$4",
      [tiedTimestamp, owner.appId, owner.userId, goal.id]);
    await pool.query("UPDATE zook_lighttick_tasks SET updated_at=$1 WHERE app_id=$2 AND user_id=$3 AND id=ANY($4::text[])",
      [tiedTimestamp, owner.appId, owner.userId, [first.id, second.id]]);
    await pool.query("UPDATE zook_lighttick_tasks SET updated_at=$1 WHERE app_id=$2 AND user_id=$3 AND id=$4",
      ["2026-11-22T08:00:00Z", owner.appId, owner.userId, older.id]);
    await pool.query(`UPDATE zook_lighttick_tasks SET lesson_source=$1::jsonb, notes=$2, updated_at=$3
      WHERE app_id=$4 AND user_id=$5 AND id=ANY($6::text[])`,
    [JSON.stringify(lessonSource), "First paging target. Private lesson detail.", "2026-11-24T08:00:00Z",
      owner.appId, owner.userId, [lesson.id, secondLesson.id]]);
    await pool.query(`UPDATE zook_lighttick_tasks SET lesson_source='null'::jsonb
      WHERE app_id=$1 AND user_id=$2 AND id=$3`, [owner.appId, owner.userId, second.id]);
    await repository.saveLearningAuthority({ ...authority, ...other, phase: "zook" }, 0);

    const ordinaryOrder = [recordId, goal.id, ...[first.id, second.id].sort().reverse(), older.id];
    assert.equal(await repository.getLearningAuthority(owner), undefined);
    assert.deepEqual((await search("First paging target", "task")).items.map(item => item.id), [first.id]);
    assert.equal((await search("First paging target", "task")).has_more, false);
    assert.equal((await search("Private lesson detail", "task", "20")).items.length, 0);
    assert.deepEqual((await search("Independent paging", "record")).items.map(item => item.id), [recordId]);
    const reviewHit = (await search("review%_ABC", "record")).items[0];
    assert.equal(reviewHit?.id, recordId);
    assert.equal(reviewHit.title, "Independent paging target");
    assert.equal(reviewHit.snippet, uniqueReview);
    assert.deepEqual((await search("work_reflection_next_step", "record")).items, []);
    assert.deepEqual((await search("review%_ABC", "record", "20", other)).items, []);
    assert.deepEqual((await read<{items: {id: string}[]}>("records", {q: "review%_ABC", date: "2026-11-23"})).items.map(row => row.id), [recordId]);
    assert.deepEqual((await read<{items: unknown[]}>("records", {q: "review%_ABC", date: "2026-11-22"})).items, []);
    assert.deepEqual((await search("owner's task", "task", "20", other)).items.map(item => item.id), [otherTask.id]);
    assert.deepEqual((await search("Private lesson detail", "task", "20", other)).items, []);
    const firstPage = await timeline();
    assert.equal(firstPage.items[0].occurred_at, new Date(tiedTimestamp).toISOString());
    assert.equal(decodeCursor(firstPage.next_cursor!).occurred_at, tiedTimestamp);
    assert.deepEqual(await pages(), ordinaryOrder);

    await repository.saveLearningAuthority(authority, 0);
    assert.deepEqual(await pages(), ordinaryOrder);

    await repository.saveLearningAuthority({ ...authority, phase: "zook", revision: 2 }, 1);
    const visible = [lesson.id, secondLesson.id].sort().reverse();
    assert.deepEqual(await pages(), [...visible, ...ordinaryOrder]);
    assert.deepEqual((await search("Private lesson detail", "task", "20")).items.map(item => item.id).sort(), [...visible].sort());
    const formerlyVisiblePage = await timeline();
    assert.ok(formerlyVisiblePage.next_cursor);

    await repository.saveLearningAuthority({ ...authority, phase: "zook", readingEnabled: false, revision: 3 }, 2);
    assert.deepEqual(await pages(formerlyVisiblePage.next_cursor), ordinaryOrder);
    assert.deepEqual(await pages(), ordinaryOrder);
    assert.deepEqual((await search("Private lesson detail", "task", "20")).items, []);
    assert.deepEqual((await search("Independent paging", "record")).items.map(item => item.id), [recordId]);
    await recordService.mutate(owner, recordId, "archive", {base_version: 1}, "record-search-privacy-archive");
    assert.deepEqual((await search("review%_ABC", "record")).items, []);
    assert.deepEqual((await read<{items: {id: string}[]}>("records", {q: "review%_ABC", archived: "true"})).items.map(row => row.id), [recordId]);
    await recordService.mutate(owner, recordId, "restore", {base_version: 2}, "record-search-privacy-restore");
    await recordService.mutate(owner, recordId, "save", { raw_text: "Independent paging target", record_date: "2026-11-23",
      base_version: 3, guided_answers: { work_reflection_next_step: "改为先和同事一起核对" } }, "record-search-privacy-revise");
    assert.deepEqual((await search("review%_ABC", "record")).items, []);
    assert.equal((await read<{items: unknown[]}>("records", {q: "改为先和同事一起核对"})).items.length, 1);
  } finally {
    try {
      await repository.deleteOwnerData(owner);
      await repository.deleteOwnerData(other);
    } finally {
      await pool.end();
    }
  }
});
