import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresSearchStore } from "../../src/infrastructure/database/postgres/postgres-lighttick-search-store.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))
  throw Error("A disposable local LightTick test database is required.");

const alice: LightTickOwner = { appId: "lighttick", userId: "search-content-alice" };
const bob: LightTickOwner = { appId: "lighttick", userId: "search-content-bob" };

const article = (owner: LightTickOwner, id: string, fields: { title: string; summary?: string; body?: string; topic?: string }, updatedAt: string) =>
  [owner.appId, owner.userId, id, `https://example.com/${id}`, createHash("sha256").update(`${owner.userId}/${id}`).digest("hex"), fields.title, "example.com",
    "zh", fields.topic ?? "", fields.summary ?? "", fields.body ?? "",
    fields.body ? "full" : "none", updatedAt, updatedAt];

const routePayload = (owner: LightTickOwner, id: string, brief: { title: string; goal?: string }, status: string, updatedAt: string, document: unknown) =>
  JSON.stringify({ appId: owner.appId, userId: owner.userId, id, revision: 1, status, brief, document, updatedAt });

/**
 * 文章/课程能被全局搜索命中，是前端「搜到就点得开」的前提。
 * 这里盯三件在单测里看不到、只能靠真库的行为：
 * 1. 文章正文/主题的模糊匹配，snippet 的兜底顺序；
 * 2. 课程只在嵌套 document 里出现的词也能命中（jsonb 深字段提取，踩过强转类型报错）；
 * 3. 归档课程不进结果，且两个用户的库互不可见。
 */
test("article/course search matches nested content, skips archived, isolates owners", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn });
  const store = new PostgresSearchStore((sql, values) => pool.query(sql, values));

  await pool.query("DELETE FROM zook_lighttick_reading_articles");
  await pool.query("DELETE FROM zook_lighttick_learning_routes");

  const insertArticle = (owner: LightTickOwner, id: string, fields: Parameters<typeof article>[2], updatedAt: string) =>
    pool.query(
      `INSERT INTO zook_lighttick_reading_articles
        (app_id,user_id,id,url,url_hash,title,source,language,topic,summary,body,body_kind,revision,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,1,$13,$14)`,
      article(owner, id, fields, updatedAt),
    );
  await insertArticle(alice, "article-body-hit", { title: "随便一个标题", body: "正文里写了 spaced repetition 的做法" }, "2026-11-20T08:00:00.000Z");
  await insertArticle(alice, "article-topic-hit", { title: "另一篇", topic: "spaced 主题", summary: "" }, "2026-11-21T08:00:00.000Z");
  await insertArticle(bob, "article-other-owner", { title: "别人的 spaced", body: "spaced" }, "2026-11-22T08:00:00.000Z");

  const articles = await store.searchArticles(alice, "spaced", 10);
  assert.deepEqual(articles.map(hit => hit.id), ["article-topic-hit", "article-body-hit"]);
  assert.equal(articles[0].kind, "article");
  assert.equal(articles[0].snippet, "spaced 主题", "摘要为空时用主题兜底");
  assert.equal(articles[1].snippet, undefined, "没有摘要和主题就不编 snippet");
  assert.equal((await store.searchArticles(alice, "spaced", 1)).length, 1, "limit 生效");

  await pool.query(
    "INSERT INTO zook_lighttick_learning_routes (app_id,user_id,id,revision,payload) VALUES ($1,$2,$3,$4,$5::jsonb),($6,$7,$8,$9,$10::jsonb),($11,$12,$13,$14,$15::jsonb)",
    [
      alice.appId, alice.userId, "course-doc-hit", 1,
      routePayload(alice, "course-doc-hit", { title: "数据结构的课", goal: "把树和堆吃透" }, "active", "2026-11-21T08:00:00.000Z",
        { modules: [{ id: "m1", title: "基础", lessons: [{ id: "l1", summary: "用 spaced 间隔重复复习平衡树" }] }] }),
      alice.appId, alice.userId, "course-archived-hit", 1,
      routePayload(alice, "course-archived-hit", { title: "归档的 spaced 课" }, "archived", "2026-11-23T08:00:00.000Z", {}),
      alice.appId, alice.userId, "course-goal-hit", 1,
      routePayload(alice, "course-goal-hit", { title: "别的一门课", goal: " spaced 复习计划" }, "active", "2026-11-20T08:00:00.000Z", {}),
    ],
  );

  const courses = await store.searchCourses(alice, "spaced", 10);
  assert.deepEqual(courses.map(hit => hit.id), ["course-doc-hit", "course-goal-hit"], "归档课程排除，按 updatedAt 倒序");
  assert.equal(courses[0].title, "数据结构的课");
  assert.equal(courses[0].snippet, "把树和堆吃透");
  assert.equal(courses[0].status, "active");
  assert.equal((await store.searchCourses(alice, "spaced", 1)).length, 1);

  const bobArticles = await store.searchArticles(bob, "spaced", 10);
  assert.deepEqual(bobArticles.map(hit => hit.id), ["article-other-owner"], "文章只看到自己的");
  assert.equal((await store.searchCourses(bob, "spaced", 10)).length, 0, "课程按用户隔离");

  await pool.end();
});
