import assert from "node:assert/strict";
import { test } from "node:test";

import { LIGHTTICK_AI_SCENES, LIGHTTICK_OUTPUT_SCHEMAS } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_SCENE_PROMPTS } from "../../src/modules/lighttick/ai/lighttick-ai-prompts.ts";
import { validateReadingGuideOutput } from "../../src/modules/lighttick/ai/lighttick-ai-validation.ts";
import { assembleLightTickContext, READING_BODY_CONTEXT_CHARS } from "../../src/modules/lighttick/ai/lighttick-ai-context.ts";

/**
 * 导读的两条不变量：
 * 1. 四个分区必须逐条有内容，空字符串不算内容；
 * 2. `basis` 只往保守方向纠正——只有摘要时不许声称读了全文。
 */

function guide(overrides: Record<string, unknown> = {}) {
  return {
    basis: "full_text",
    core_points: ["作者认为复习间隔比总时长更影响留存。"],
    evidence_limits: ["样本只有 12 人，不能外推到全部学习者。"],
    language_notes: [],
    application_questions: ["你上一次复习是在学完多久之后？"],
    ...overrides,
  };
}

test("导读：正常输出通过，且条目被去掉首尾空白", () => {
  const result = validateReadingGuideOutput(
    guide({ core_points: ["  第一条  ", "第二条"] }),
    "full_text",
  );
  assert.equal(result.basis, "full_text");
  assert.deepEqual(result.core_points, ["第一条", "第二条"]);
  assert.deepEqual(result.language_notes, []);
});

test("导读：只有摘要时，模型声称 full_text 会被纠正为 summary", () => {
  const result = validateReadingGuideOutput(guide({ basis: "full_text" }), "summary");
  assert.equal(result.basis, "summary", "只有摘要却声称读了全文，必须纠正");
});

test("导读：有全文而模型自认只基于摘要，保留更保守的说法", () => {
  const result = validateReadingGuideOutput(guide({ basis: "summary" }), "full_text");
  assert.equal(result.basis, "summary");
});

test("导读：未知 basis 判失败", () => {
  assert.throws(() => validateReadingGuideOutput(guide({ basis: "skimmed" }), "full_text"),
    /basis is invalid/);
});

test("导读：core_points 为空或含空白条目判失败", () => {
  assert.throws(() => validateReadingGuideOutput(guide({ core_points: [] }), "full_text"),
    /core_points is invalid/);
  assert.throws(() => validateReadingGuideOutput(guide({ core_points: ["  "] }), "full_text"),
    /core_points contains an invalid entry/);
  assert.throws(() => validateReadingGuideOutput(guide({ core_points: "一条" }), "full_text"),
    /core_points is invalid/);
});

test("导读：application_questions 至少一条，evidence_limits 可以为空", () => {
  assert.throws(() => validateReadingGuideOutput(guide({ application_questions: [] }), "full_text"),
    /application_questions is invalid/);
  const result = validateReadingGuideOutput(guide({ evidence_limits: [] }), "full_text");
  assert.deepEqual(result.evidence_limits, []);
});

test("导读：单条超长判失败，不是截断了事", () => {
  assert.throws(() => validateReadingGuideOutput(guide({ core_points: ["字".repeat(401)] }), "full_text"),
    /core_points contains an invalid entry/);
});

test("导读：分区数量上限生效", () => {
  assert.throws(() => validateReadingGuideOutput(guide({ core_points: ["a", "b", "c", "d", "e", "f", "g"] }), "full_text"),
    /core_points is invalid/);
});

test("导读：scene 与输出 schema 已注册，且无模板兜底", () => {
  const scene = LIGHTTICK_AI_SCENES.reading_guide;
  assert.equal(scene.key, "lighttick.reading_guide.v1");
  assert.equal(scene.kind, "reading_guide");
  // 没有模型就不生成导读——不拿模板凑一份看起来像导读的东西。
  assert.equal(scene.fallback, "none");
  const schema = LIGHTTICK_OUTPUT_SCHEMAS.reading_guide as any;
  assert.deepEqual([...schema.required].sort(),
    ["application_questions", "basis", "core_points", "evidence_limits", "language_notes"]);
  assert.deepEqual(schema.properties.basis.enum, ["full_text", "summary"]);
});

test("导读：prompt 明确禁止读私人反馈、禁止编造、禁止用全文口径掩盖只有摘要", () => {
  const prompt = LIGHTTICK_SCENE_PROMPTS.reading_guide;
  assert.match(prompt, /untrusted quoted data/);
  assert.match(prompt, /private notes, ratings, questions/);
  assert.match(prompt, /set basis to summary/);
  assert.match(prompt, /Never invent facts/);
});

test("每个已注册 scene 都能通过路由配置解析（缺一条就会让全部 AI 调用失败）", () => {
  // app-ai-routing-config 的解析器要求每个 LIGHTTICK_AI_SCENES 条目都满足这些约束；
  // 任一 scene 不满足，存量 routing 文档解析就会整体抛错，而不是只坏一个 scene。
  for (const [name, scene] of Object.entries(LIGHTTICK_AI_SCENES)) {
    assert.ok(scene.modelAlias.trim().length > 0, `${name} 需要 modelAlias`);
    assert.ok(Number.isInteger(scene.timeoutMs) && scene.timeoutMs >= 1000, `${name} timeoutMs 不合法`);
    assert.ok(Number.isInteger(scene.maxContextTokens) && scene.maxContextTokens >= 1, `${name} maxContextTokens 不合法`);
    assert.ok(Number.isInteger(scene.maxOutputTokens) && scene.maxOutputTokens >= 1, `${name} maxOutputTokens 不合法`);
    assert.ok(typeof scene.maxEstimatedCostUsd === "number" && scene.maxEstimatedCostUsd >= 0, `${name} 成本上限不合法`);
    assert.ok(["template", "facts_only", "none"].includes(scene.fallback), `${name} fallback 不合法`);
  }
});

const owner = { appId: "lighttick", userId: "user_test" };

/** 只实现导读需要的三个方法；读反馈的方法故意抛错，用来证明它根本没被调用。 */
function readingRepository(article: Record<string, unknown>) {
  const calls: string[] = [];
  return {
    calls,
    async getProfile() { calls.push("getProfile"); return { timezone: "Asia/Shanghai", pace: "steady" }; },
    async getReadingArticle(_owner: unknown, id: string) { calls.push(`getReadingArticle:${id}`); return article; },
    async getReadingFeedback() { throw new Error("导读上下文不得读取私人反馈"); },
    async listReviews() { throw new Error("导读上下文不得读取复盘"); },
  };
}

function articleRow(overrides: Record<string, unknown> = {}) {
  return {
    appId: "lighttick", userId: "user_test", id: "art_1", url: "https://example.com/a", urlHash: "hash",
    title: "注意力是稀缺资源", source: "示例周刊", language: "zh", topic: "心理",
    summary: "摘要：注意力有限。", body: "全文第一段。", bodyKind: "full", revision: 1,
    createdAt: "2026-11-14T00:00:00.000Z", updatedAt: "2026-11-14T00:00:00.000Z",
    ...overrides,
  };
}

test("导读上下文：有全文时依据为 full_text，且不读私人反馈", async () => {
  const repository = readingRepository(articleRow());
  const context: any = await assembleLightTickContext(repository as any, owner as any, { article_id: "art_1" });
  assert.equal(context.article.authoritative_basis, "full_text");
  assert.equal(context.article.body_truncated, false);
  assert.equal(context.article.body, "全文第一段。");
  assert.equal("feedback" in context, false, "上下文里不应出现反馈字段");
  assert.ok(!repository.calls.some((call) => call.startsWith("getReadingFeedback")), "不得读取反馈");
});

test("导读上下文：只有摘要时依据为 summary，正文为空", async () => {
  const repository = readingRepository(articleRow({ bodyKind: "none", body: "" }));
  const context: any = await assembleLightTickContext(repository as any, owner as any, { article_id: "art_1" });
  assert.equal(context.article.authoritative_basis, "summary");
  assert.equal(context.article.body, "");
});

test("导读上下文：正文超长被截断，依据同时降级为 summary", async () => {
  const longBody = "字".repeat(READING_BODY_CONTEXT_CHARS + 500);
  const repository = readingRepository(articleRow({ body: longBody }));
  const context: any = await assembleLightTickContext(repository as any, owner as any, { article_id: "art_1" });
  assert.equal(context.article.body.length, READING_BODY_CONTEXT_CHARS, "正文必须截到上限");
  assert.equal(context.article.body_truncated, true);
  assert.equal(context.article.authoritative_basis, "summary",
    "只给了正文前一段却声称基于全文，是这一域最不能出的谎");
});

test("导读上下文：文章不存在时 404，而不是产出空上下文", async () => {
  const repository = readingRepository(undefined);
  await assert.rejects(
    () => assembleLightTickContext(repository as any, owner as any, { article_id: "art_missing" }),
    /Reading article was not found/,
  );
});
