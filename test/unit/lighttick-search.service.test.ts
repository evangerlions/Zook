import test from "node:test";
import assert from "node:assert/strict";
import { LightTickSearchService, encodeCursor, decodeCursor } from "../../src/modules/lighttick/lighttick-search.service.ts";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickSearchHit, LightTickTimelineItem, TimelineCursor } from "../../src/infrastructure/database/postgres/postgres-lighttick-search-store.ts";

type MockRepository = Pick<LightTickRepository, "searchRecords" | "searchGoals" | "searchTasks" | "searchArticles" | "searchCourses" | "listTimeline">;

const owner = { appId: "lighttick" as const, userId: "u-test" };

function buildRepo(overrides: Partial<MockRepository> = {}): MockRepository {
  return {
    searchRecords: async () => [],
    searchGoals: async () => [],
    searchTasks: async () => [],
    searchArticles: async () => [],
    searchCourses: async () => [],
    listTimeline: async () => [],
    ...overrides,
  };
}

function hit(partial: Partial<LightTickSearchHit> & Pick<LightTickSearchHit, "kind" | "id">): LightTickSearchHit {
  return {
    kind: partial.kind,
    id: partial.id,
    title: "title",
    updated_at: "2026-11-14T10:00:00.000Z",
    ...partial,
  };
}

test("search rejects empty or oversized q", async () => {
  const service = new LightTickSearchService(buildRepo() as LightTickRepository);
  await assert.rejects(service.search(owner, { q: "" }), /q must be 1-200/);
  await assert.rejects(service.search(owner, { q: "   " }), /q must be 1-200/);
  await assert.rejects(service.search(owner, { q: "x".repeat(201) }), /q must be 1-200/);
});

test("search rejects invalid scope values", async () => {
  const service = new LightTickSearchService(buildRepo() as LightTickRepository);
  await assert.rejects(service.search(owner, { q: "hello", scope: ["unknown" as never] }), /scope contains invalid kind/);
  await assert.rejects(service.search(owner, { q: "hello", scope: [] }), /scope must not be empty/);
});

test("search rejects invalid limit", async () => {
  const service = new LightTickSearchService(buildRepo() as LightTickRepository);
  await assert.rejects(service.search(owner, { q: "hello", limit: 0 }), /limit must be 1-50/);
  await assert.rejects(service.search(owner, { q: "hello", limit: 51 }), /limit must be 1-50/);
});

test("default search also covers articles and courses", async () => {
  const calls: string[] = [];
  const repo = buildRepo({
    searchArticles: async () => { calls.push("article"); return [hit({ kind: "article", id: "a1", updated_at: "2026-11-14T11:00:00.000Z" })]; },
    searchCourses: async () => { calls.push("course"); return [hit({ kind: "course", id: "c1", updated_at: "2026-11-14T10:30:00.000Z" })]; },
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const result = await service.search(owner, { q: "汇报" });
  // 搜「汇报」这类词时，文章和课程也是内容，不能只搜记录/目标/行动。
  assert.deepEqual(calls, ["article", "course"]);
  assert.deepEqual(result.items.map(i => i.kind), ["article", "course"]);
});

test("search can be restricted to articles only", async () => {
  const calls: string[] = [];
  const repo = buildRepo({
    searchRecords: async () => { calls.push("record"); return []; },
    searchArticles: async () => { calls.push("article"); return [hit({ kind: "article", id: "a1" })]; },
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const result = await service.search(owner, { q: "hello", scope: ["article"] });
  assert.deepEqual(calls, ["article"]);
  assert.equal(result.items.length, 1);
});

test("search fans out across all three kinds and merges by updated_at", async () => {
  const calls: string[] = [];
  const repo = buildRepo({
    searchRecords: async (_o, _q, _l) => { calls.push("record"); return [hit({ kind: "record", id: "r1", updated_at: "2026-11-14T09:00:00.000Z" })]; },
    searchGoals: async (_o, _q, _l) => { calls.push("goal"); return [hit({ kind: "goal", id: "g1", updated_at: "2026-11-14T10:00:00.000Z" })]; },
    searchTasks: async (_o, _q, _l) => { calls.push("task"); return [hit({ kind: "task", id: "t1", updated_at: "2026-11-14T08:00:00.000Z" })]; },
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const result = await service.search(owner, { q: "hello" });
  assert.deepEqual(calls.sort(), ["goal", "record", "task"]);
  assert.deepEqual(result.items.map(i => i.id), ["g1", "r1", "t1"]);
  assert.equal(result.has_more, false);
});

test("search respects scope filter", async () => {
  const calls: string[] = [];
  const repo = buildRepo({
    searchGoals: async () => { calls.push("goal"); return [hit({ kind: "goal", id: "g1" })]; },
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const result = await service.search(owner, { q: "hello", scope: ["goal"] });
  assert.deepEqual(calls, ["goal"]);
  assert.equal(result.items.length, 1);
});

test("search has_more flags when merged results exceed limit", async () => {
  const repo = buildRepo({
    searchRecords: async () => [hit({ kind: "record", id: "r1", updated_at: "2026-11-14T09:00:00.000Z" }), hit({ kind: "record", id: "r2", updated_at: "2026-11-14T08:00:00.000Z" })],
    searchGoals: async () => [hit({ kind: "goal", id: "g1", updated_at: "2026-11-14T10:00:00.000Z" })],
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const result = await service.search(owner, { q: "hello", limit: 2 });
  assert.equal(result.items.length, 2);
  assert.equal(result.has_more, true);
});

test("timeline validates limit", async () => {
  const service = new LightTickSearchService(buildRepo() as LightTickRepository);
  await assert.rejects(service.timeline(owner, { limit: 0 }), /limit must be 1-100/);
  await assert.rejects(service.timeline(owner, { limit: 101 }), /limit must be 1-100/);
});

test("timeline returns items and next_cursor when hasMore", async () => {
  const items: LightTickTimelineItem[] = Array.from({ length: 4 }, (_, i) => ({
    occurred_at: `2026-11-14T10:0${3 - i}:00.000Z`,
    kind: "record" as const,
    id: `r${i}`,
    title: `t${i}`,
  }));
  const repo = buildRepo({
    listTimeline: async (_o, limit, _cursor) => items.slice(0, limit).map(item => ({
      ...item, cursor_occurred_at: item.occurred_at,
    })),
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const page = await service.timeline(owner, { limit: 3 });
  assert.equal(page.items.length, 3);
  assert.deepEqual(page.items, items.slice(0, 3));
  assert.ok(page.next_cursor);
  const decoded = decodeCursor(page.next_cursor!);
  assert.equal(decoded.id, "r2");
});

test("timeline decodes cursor and forwards to repository", async () => {
  let seen: TimelineCursor | undefined;
  const repo = buildRepo({
    listTimeline: async (_o, _limit, cursor) => { seen = cursor; return []; },
  });
  const service = new LightTickSearchService(repo as LightTickRepository);
  const cursor = encodeCursor({ occurred_at: "2026-11-14T10:00:00.000Z", kind: "goal", id: "g-1" });
  await service.timeline(owner, { cursor });
  assert.deepEqual(seen, { occurred_at: "2026-11-14T10:00:00.000Z", kind: "goal", id: "g-1" });
});

test("timeline rejects malformed cursor", async () => {
  const service = new LightTickSearchService(buildRepo() as LightTickRepository);
  await assert.rejects(service.timeline(owner, { cursor: "not-base64url-json" }), /cursor is malformed/);
  await assert.rejects(service.timeline(owner, { cursor: Buffer.from(JSON.stringify({ occurred_at: "nope", kind: "record", id: "x" })).toString("base64url") }), /cursor is malformed/);
  await assert.rejects(service.timeline(owner, { cursor: Buffer.from(JSON.stringify({ occurred_at: "2026-11-14T10:00:00.000Z", kind: "weird", id: "x" })).toString("base64url") }), /cursor is malformed/);
});

test("encodeCursor/decodeCursor round-trips", () => {
  const original: TimelineCursor = { occurred_at: "2026-11-14T10:00:00.000Z", kind: "task", id: "t-42" };
  assert.deepEqual(decodeCursor(encodeCursor(original)), original);
});
