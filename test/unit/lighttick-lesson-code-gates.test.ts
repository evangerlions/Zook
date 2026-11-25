import assert from "node:assert/strict";
import test from "node:test";
import { lessonCodeGates, lessonRegions } from "../../src/modules/lighttick/learning/lesson-code-gates.ts";
import { readingMinutes, validateLessonDesign } from "../../src/modules/lighttick/learning/lesson-design.validation.ts";
import { validateLearningGeneration } from "../../src/modules/lighttick/learning/learning-work-generation.ts";
import type { LearningWork } from "../../src/modules/lighttick/learning/learning-work.types.ts";

/** 十段骨架；默认可见区已按 8 分钟课补足实质门（≥320 汉字），参数可继续调篇幅。 */
function body(options: { visibleChars?: number; referenceChars?: number; practice?: string; concept?: string } = {}) {
  const visibleChars = options.visibleChars ?? 400;
  const filler = "核对来源并标注口径".repeat(Math.ceil(visibleChars / 8)).slice(0, visibleChars);
  const reference = "只判断已核实的事实，未核实的一律标注待确认。".repeat(Math.ceil((options.referenceChars ?? 0) / 22)).slice(0, options.referenceChars ?? 0);
  return [
    "## 引导问题\n为什么要把已核实和待核实分开说？",
    "## 回忆检查\n1. 什么算可核对的事实？",
    `## 概念\n${options.concept ?? "进度说明只写已核实事项，未核实事项单独标注。"}`,
    "## 示范\n先写已核实的一条，再写待核实的一条。",
    "## 边界\n不把未知说成已确认。",
    `## 练习\n写一句进度说明。${options.practice ?? ""}`,
    "## 迁移任务\n换一个场景再写一次。",
    filler ? `## 补充说明\n${filler}` : "",
    "---",
    `## 参考分析\n${reference || "只有已核对的事项可以作为确定依据。"}`,
    "## 自查\n每条依据是否有对象？",
    "## 记忆提示\n事实与判断分开。",
  ].filter(Boolean).join("\n\n");
}

function design(overrides: Record<string, unknown> = {}) {
  return {
    primary_concept: "进度说明",
    objective: "写出一句含已核实与待核实事项的进度说明",
    concepts_used: ["进度说明"],
    estimated_read_minutes: 1,
    estimated_practice_minutes: 8,
    exercise_rubric: [
      { title: "事实可核对", standard: "至少一条事实能追到来源。" },
      { title: "区分待核实事项", standard: "待核实事项单独标注，不冒充已确认。" },
    ],
    covers: [],
    ...overrides,
  };
}

const blueprint = { number: 1, topic: "进度说明：先写事实再写判断", goal: "写出进度说明", minutes: 8, kind: "lesson" as const };

// 8.1 工作量门：短课不再被十段骨架误杀，明显超载仍然失败。
test("an eight minute lesson with a long visible body still passes because the five minute overhead is allowed", () => {
  // 可见区约 1600 汉字 ≈ 4.6 分钟阅读 + 8 分钟练习 = 12.6 分钟，落在 8 分钟课节的 13 分钟上界内。
  const content = body({ visibleChars: 1500 });
  const ok = validateLessonDesign(design(), blueprint, content);
  assert.ok(ok.design_check.total_minutes <= 13, JSON.stringify(ok.design_check));
  assert.equal(ok.design_check.tolerance, 0.3);
  assert.ok(ok.design_check.tolerance_upper !== undefined && ok.design_check.tolerance_upper > 0.3);
});

test("an eight minute lesson that is clearly overloaded still fails", () => {
  assert.throws(
    () => validateLessonDesign(design({ estimated_practice_minutes: 20 }), blueprint, body({ visibleChars: 1690 })),
    (error: any) => error.statusCode === 422 && /outside .* minutes for the blueprint/.test(error.message),
  );
});

test("reference analysis below the separator is not counted as first-pass reading", () => {
  const short = validateLessonDesign(design(), blueprint, body({ visibleChars: 400, referenceChars: 400 }));
  const long = validateLessonDesign(design(), blueprint, body({ visibleChars: 400, referenceChars: 4000 }));
  assert.equal(short.design_check.computed_read_minutes, long.design_check.computed_read_minutes);
  assert.equal(short.design_check.total_minutes, long.design_check.total_minutes);
  assert.equal(lessonRegions(body({ visibleChars: 400, referenceChars: 400 })).reference.length > 0, true);
  assert.equal(readingMinutes(lessonRegions(body({ visibleChars: 300 })).visible).minutes > 0, true);
});

// 8.2 主概念门：单字与「不在开头的子串」都不算概念。
test("a single character primary concept is rejected", () => {
  assert.throws(
    () => validateLessonDesign(design({ primary_concept: "的" }), blueprint, body()),
    (error: any) => error.statusCode === 422 && /at least two Chinese characters/.test(error.message),
  );
});

test("a primary concept outside the blueprint topic is rejected with a fixable reason", () => {
  assert.throws(
    () => validateLessonDesign(design({ primary_concept: "写作规范" }), blueprint, body()),
    (error: any) => error.statusCode === 422 && /is not part of the blueprint topic/.test(error.message),
  );
});

test("a two character concept at the topic head passes and an English word still counts", () => {
  const ok = validateLessonDesign(design(), blueprint, body());
  assert.equal(ok.primary_concept, "进度说明");
  const latin = validateLessonDesign(
    design({ primary_concept: "First" }),
    { ...blueprint, topic: "First steps in writing" },
    body(),
  );
  assert.equal(latin.primary_concept, "First");
});

// 4.6 B3：只重算显式等号两侧的纯数值表达式。
test("a percentage equality is compared as a ratio, not as a bare number", () => {
  // 真实语料：正文写「4/5 = 80%」，旧的字符类不含 %，被读成 0.8 vs 80 而误判致命。
  const result = lessonCodeGates("## 示范\n完成 4/5 项，即 4/5 = 80%。", "## 参考分析\n略");
  assert.equal(result.fatal.length, 0);
});

test("a numeric equality that does not add up is fatal", () => {
  const result = lessonCodeGates(body({ practice: "12 + 8 = 21，核对一下。" }), 8);
  assert.equal(result.fatal.length, 1);
  assert.match(result.fatal[0]!, /does not add up/);
});

test("dates, ranges and percentages are left unverified instead of failing", () => {
  const content = body({
    practice: "预算区间 2026-11-25 至 2026-12-01，完成率 80%，版本 1.23.1，单条预计 12 分钟。",
  });
  const result = lessonCodeGates(content, 8);
  assert.deepEqual(result.fatal, []);
  assert.deepEqual(result.repairable, []);
});

// 4.7 B4：选项去重、正确项恰好一个、答案键必须落在选项内。
test("duplicate choice options are repairable", () => {
  const content = body({ practice: "\nA．只写已核实事实\nB．只写待核实事项\nC．只写已核实事实" });
  const result = lessonCodeGates(content, 8);
  assert.equal(result.fatal.length, 0);
  assert.ok(result.repairable.some(issue => /duplicates/.test(issue)), JSON.stringify(result));
});

test("a single-correct multiple choice lesson passes, but a multi-answer key is repairable", () => {
  const options = "\nA．只写已核实事实\nB．只写待核实事项\nC．把未知写成已确认";
  const pass = lessonCodeGates(body({ practice: options }), 8);
  assert.deepEqual(pass.fatal, []);
  // 参考分析没有答案键时，答案一致性标为未核验而不是判失败。
  assert.ok(pass.unverified.some(entry => entry.startsWith("choice:") || entry.startsWith("choice:no_answer_key")));
  const content = body({ practice: options }).replace("## 参考分析\n", "## 参考分析\n答案：A、B。");
  const violated = lessonCodeGates(content, 8);
  assert.equal(violated.fatal.length, 0);
  assert.ok(violated.repairable.some(issue => /exactly one/.test(issue)), JSON.stringify(violated));
});

// 4.8 B5：否定式题干一律改写为正向。
test("a negative exercise stem is repairable", () => {
  const result = lessonCodeGates(body({ practice: "以下哪项不属于已核实事实？" }), 8);
  assert.equal(result.fatal.length, 0);
  assert.ok(result.repairable.some(issue => /negative form/.test(issue)), JSON.stringify(result));
});

// 4.9 B6：连续 ≥12 字的判定句出现在可见区即判泄漏，概念段换说法则不算。
test("a decisive sentence copied into the visible body is repairable", () => {
  const leak = "只有已核对的事项可以作为确定依据";
  const result = lessonCodeGates(body({ concept: `判断标准是：${leak}。` }), 8);
  assert.equal(result.fatal.length, 0);
  assert.ok(result.repairable.some(issue => /repeats a decisive sentence/.test(issue)), JSON.stringify(result));
});

test("restating the idea in different words above the separator is not a leak", () => {
  const result = lessonCodeGates(body({ concept: "先说核对过的，再说没核对的。" }), 8);
  assert.deepEqual(result.repairable, []);
});

// 5.1 C2：正文声明的分钟必须与蓝图对账。
test("a declared lesson length that contradicts the blueprint is fatal", () => {
  const result = lessonCodeGates(body({ practice: "本课共 20 分钟。" }), 8);
  assert.equal(result.fatal.length, 1);
  assert.match(result.fatal[0]!, /declares 20 minutes/);
  const ok = lessonCodeGates(body({ practice: "本课共 8 分钟。" }), 8);
  assert.deepEqual(ok.fatal, []);
});

test("per-section minutes that do not add up to the blueprint are fatal", () => {
  const content = [
    "## 引导问题（2 分钟）\n为什么要分开说？",
    "## 概念（3 分钟）\n只写已核实事项。",
    "## 练习（10 分钟）\n写一句进度说明。",
    "## 迁移任务（2 分钟）\n换个场景。",
    "---",
    "## 参考分析\n只有已核对的事项可以作为确定依据。",
  ].join("\n\n");
  const result = lessonCodeGates(content, 8);
  assert.ok(result.fatal.some(issue => /section minutes add up to 17/.test(issue)), JSON.stringify(result.fatal));
});

// 5.2 C6：课节草稿被 max_tokens 截断时直接拒稿。
test("a truncated lesson draft is rejected before any parse", () => {
  const work = { kind: "lesson_draft", input: { lesson: blueprint, sources: [] } } as unknown as LearningWork;
  assert.throws(
    () => validateLearningGeneration(
      { work, sources: [], quotes: [], sceneKey: "lighttick.lesson_draft" },
      { text: '{"content":"## 引导问题', finishReason: "length", provider: "fake", providerModel: "fake" },
    ),
    (error: any) => error.statusCode === 422 && /truncated/.test(error.message),
  );
});
