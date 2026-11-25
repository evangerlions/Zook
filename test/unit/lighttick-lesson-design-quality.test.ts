import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LESSON_OUTPUT_SCHEMA } from "../../src/modules/lighttick/learning/learning-work-generation.ts";
import { validateLessonDesign } from "../../src/modules/lighttick/learning/lesson-design.validation.ts";
import { parseSolvability, solvabilityBody, solvabilityInput } from "../../src/modules/lighttick/learning/lesson-solvability.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";

const owner = { appId: "lighttick" as const, userId: "lesson-quality-owner" };
const routeId = "plan-lesson-quality";
const source = { kind: "text" as const, title: "合成资料", text: "已核实事项来自可复查的记录，待核实事项尚未确认来源。" };

/** 十段正文：回忆检查与迁移任务在分隔线之上，答案分析在分隔线之下。 */
function tenSections(practiceExtra = "") {
  return [
    "## 引导问题\n为什么要把已核实和待核实分开说？",
    "## 回忆检查\n1. 什么算可核对的事实？\n2. 一条判断需要几条依据？",
    "## 概念\n结论要建立在可核对的事实上。",
    "## 示范\n第一步列出已核实事项，因为来源可复查；第二步标注待核实事项，因为来源尚未确认。",
    "## 边界\n不把未知说成已确认。",
    "## 练习\n写一句进度说明。完成标准：至少含一条已核实事实与一条待核实事项。" + practiceExtra,
    "## 迁移任务\n换一个场景再写一次进度说明。",
    "---",
    "## 参考分析\n只有已核对的事项可以作为确定依据。",
    "## 自查\n每条依据是否有明确对象？",
    "## 记忆提示\n事实与判断分开。",
  ].join("\n\n");
}

const legacyEight = [
  "## 引导问题\n为什么要区分？", "## 概念\n结论要可核对。", "## 示范\n先列事实再下判断。",
  "## 边界\n不把未知说成已确认。", "## 练习\n写一句进度说明。", "---",
  "## 参考分析\n只有已核对的事项可作依据。", "## 自查\n依据有对象吗？", "## 记忆提示\n事实与判断分开。",
].join("\n\n");

function design(overrides: Record<string, unknown> = {}) {
  return {
    primary_concept: "First",
    objective: "写出一句含已核实与待核实事项的进度说明",
    concepts_used: ["First"],
    estimated_read_minutes: 1,
    estimated_practice_minutes: 14,
    exercise_rubric: ["事实可核对", "区分待核实事项"],
    covers: [],
    ...overrides,
  };
}

const solvable = { answerable: true, missing_conditions: [], expected_points: ["一条已核实事实", "一条待核实事项"], confidence: 0.9 };
const unsolvable = { answerable: false, missing_conditions: ["缺少可核对事实的判定口径"], expected_points: [], confidence: 0.8 };
const blueprint = { number: 1, topic: "First", goal: "Explain", minutes: 15, kind: "lesson" as const };

function setup(options: { solve?: Record<string, unknown>[]; lesson?: Record<string, unknown>[] } = {}) {
  const now = new Date("2026-11-25T08:00:00Z");
  const repository = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repository, true, () => now);
  const routes = new LearningRouteService(native);
  const work = new LearningWorkService(routes, new InMemoryJobQueue());
  const calls: { body: Record<string, any>; instruction: string; request: LLMCompletionRequest }[] = [];
  let lessonCall = 0;
  let solveCall = 0;
  const llm = {
    complete: async (request: LLMCompletionRequest) => {
      const instruction = String(request.messages[1]!.content);
      const body = JSON.parse(instruction.split("\nINPUT_JSON=")[1]!);
      calls.push({ body, instruction, request });
      const output = body.teaching_body !== undefined
        ? (options.solve?.[solveCall++] ?? solvable)
        : (options.lesson?.[lessonCall++] ?? { content: tenSections(), references: source.title, design: design() });
      return { provider: "fake", providerModel: "lesson-quality", modelKey: "lesson-quality", text: JSON.stringify(output) };
    },
  };
  const runner = new LearningWorkRunner(work, llm, {
    readFile: async () => { throw new Error("Lesson quality fixtures read no owner files."); },
    fetchUrl: async () => { throw new Error("Lesson quality fixtures fetch no URLs."); },
  });
  return { repository, native, routes, work, runner, calls };
}

async function draftLesson(f: ReturnType<typeof setup>, key: string) {
  await f.routes.save(owner, routeId, { base_revision: 0, ...routeFixture() }, key + "-route");
  const route = await f.routes.publish(owner, routeId, { base_revision: 1 }, key + "-publish");
  const job = await f.work.create(owner, {
    kind: "lesson_draft", route_id: routeId, base_revision: route.revision, number: 1, sources: [source],
  }, key + "-lesson");
  await f.runner.execute(owner, job.id);
  return f.work.read(owner, job.id);
}

// 例 1：通过。design 与盲解结论都留档，正文不含裁决。
test("a well designed lesson passes the design gate and records its blind solve verdict", async () => {
  const f = setup();
  const result = await draftLesson(f, "quality-pass");
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(result.output.design.primary_concept, "First");
  assert.equal(result.output.design.design_check.blueprint_minutes, 15);
  assert.ok(Math.abs(result.output.design.design_check.workload_deviation) <= 0.3);
  assert.equal(result.output.solvability.answerable, true);
  assert.equal(result.output.solvability.repairs, 0);
  assert.equal(result.output.prompt_version, "1.23.1");
  assert.doesNotMatch(result.output.content, /answerable|missing_conditions/);
  assert.equal(f.calls.length, 2, "one lesson call plus one blind solve call");
  // 3.2 盲解输入只拿目标、评分标准、回忆检查至练习的正文与来源摘要。
  const solve = f.calls[1]!.body;
  assert.equal(solve.objective, design().objective);
  assert.deepEqual(solve.exercise_rubric, design().exercise_rubric);
  assert.match(solve.teaching_body, /回忆检查/);
  assert.doesNotMatch(solve.teaching_body, /参考分析|自查|记忆提示|迁移任务/);
  assert.equal(solve.approved_sources[0].digest.length > 0, true);
  assert.equal(f.calls[1]!.request.usageOwner.userId, owner.userId, "3.5 复用同一计费主体");
});

// 例 2：主概念不符。
test("a primary concept outside the blueprint topic is rejected with a fixable reason", () => {
  assert.throws(
    () => validateLessonDesign(design({ primary_concept: "Second" }), blueprint, tenSections()),
    (error: any) => error.statusCode === 422 && /substring of the blueprint topic/.test(error.message),
  );
});

// 例 3：目标不可观察。
test("an objective that only says 了解 or 熟悉 is rejected", () => {
  for (const objective of ["了解这个概念", "熟悉进度说明"]) {
    assert.throws(
      () => validateLessonDesign(design({ objective }), blueprint, tenSections()),
      (error: any) => error.statusCode === 422 && /observable action/.test(error.message),
    );
  }
});

// 例 4：评分维度不足。
test("an exercise rubric with fewer than two dimensions is rejected", () => {
  assert.throws(
    () => validateLessonDesign(design({ exercise_rubric: ["事实可核对"] }), blueprint, tenSections()),
    (error: any) => error.statusCode === 422 && /at least two/.test(error.message),
  );
  assert.throws(
    () => validateLessonDesign(design({ exercise_rubric: ["事实可核对", "  "] }), blueprint, tenSections()),
    (error: any) => error.statusCode === 422,
  );
});

// 例 5：工作量超限。
test("a lesson whose workload exceeds the blueprint budget by more than 30% is rejected", () => {
  assert.throws(
    () => validateLessonDesign(design({ estimated_practice_minutes: 40 }), blueprint, tenSections()),
    (error: any) => error.statusCode === 422 && /deviates/.test(error.message),
  );
  // 压缩范围而不是压缩标题：预算内的练习分钟仍然通过。
  const ok = validateLessonDesign(design({ estimated_practice_minutes: 12 }), blueprint, tenSections());
  assert.ok(Math.abs(ok.design_check.workload_deviation) <= 0.3);
});

// 例 6：复习课覆盖未来课次。
test("a review lesson may only cover earlier lessons and an ordinary lesson covers none", () => {
  const review = { number: 2, topic: "Review", goal: "Transfer", minutes: 20, kind: "review" as const };
  assert.throws(
    () => validateLessonDesign(design({ primary_concept: "Review", covers: [3] }), review, tenSections()),
    (error: any) => error.statusCode === 422 && /only earlier lesson numbers/.test(error.message),
  );
  assert.throws(
    () => validateLessonDesign(design({ primary_concept: "Review", covers: [] }), review, tenSections()),
    (error: any) => error.statusCode === 422 && /must list which earlier lessons/.test(error.message),
  );
  assert.throws(
    () => validateLessonDesign(design({ covers: [1] }), blueprint, tenSections()),
    (error: any) => error.statusCode === 422 && /must leave covers empty/.test(error.message),
  );
  const ok = validateLessonDesign(design({ primary_concept: "Review", covers: [1] }), review, tenSections());
  assert.deepEqual(ok.covers, [1]);
});

// 例 7：盲解一次修复通过。
test("one targeted repair adds the missing conditions and publishes the repaired lesson", async () => {
  const f = setup({
    solve: [unsolvable, solvable],
    lesson: [
      { content: tenSections(), references: source.title, design: design() },
      { content: tenSections("\n可核对事实指来源可复查的记录。"), references: source.title, design: design() },
    ],
  });
  const result = await draftLesson(f, "quality-repair");
  assert.equal(result.status, "succeeded", JSON.stringify(result));
  assert.equal(result.output.solvability.repairs, 1);
  assert.equal(result.output.solvability.answerable, true);
  assert.match(result.output.content, /可核对事实指来源可复查的记录/);
  assert.equal(f.calls.length, 4, "lesson, solve, repair, solve");
  // 3.4 修复只补条件，不改目标，也不泄露答案。
  const repair = f.calls[2]!.instruction;
  assert.match(repair, /repair_targets/);
  assert.match(repair, /缺少可核对事实的判定口径/);
  assert.match(repair, /Keep the same objective/);
  assert.match(repair, /Do not reveal the exercise answer/);
});

// 例 8：盲解两次失败 → 不发布。
test("a lesson that stays unsolvable after one repair fails and is never published", async () => {
  const f = setup({ solve: [unsolvable, unsolvable] });
  const result = await draftLesson(f, "quality-unsolvable");
  assert.equal(result.status, "failed");
  assert.equal(result.error_code, "LEARNING_OUTPUT_INVALID");
  assert.equal(result.output, null);
  assert.equal(f.calls.length, 4, "no third repair attempt");
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(owner, routeId)).length, 0);
});

// A 路线：design 必填。八段草稿不再退回最低要求，也不再有跳过盲解的短路。
test("a lesson draft without a design block is rejected instead of falling back to eight sections", async () => {
  const f = setup({ lesson: [{ content: legacyEight, references: source.title }] });
  const result = await draftLesson(f, "quality-legacy-eight");
  assert.equal(result.status, "failed", JSON.stringify(result));
  assert.equal(result.error_code, "LEARNING_OUTPUT_INVALID");
  assert.equal(result.output, null);
  assert.equal(f.calls.length, 1, "a rejected draft stops before the blind solve stage");
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(owner, routeId)).length, 0);
});

test("the lesson output schema requires the design block", () => {
  assert.deepEqual(LESSON_OUTPUT_SCHEMA.required, ["content", "references", "design"]);
  assert.ok(LESSON_OUTPUT_SCHEMA.properties.design);
});

// A 路线：历史正文可读不靠运行时豁免，靠「校验只在生成路径可达」。
// 任何把设计校验拉到读路径的改动都会让本用例失败。
test("published legacy content stays readable because the design validator is reachable only from generation", () => {
  const root = new URL("../../src/", import.meta.url);
  const offenders: string[] = [];
  const walk = (dir: URL) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const child = new URL(entry.name + (entry.isDirectory() ? "/" : ""), dir);
      if (entry.isDirectory()) walk(child);
      else if (entry.name.endsWith(".ts")) {
        const text = readFileSync(child, "utf8");
        if (!text.includes("lesson-design.validation.ts")) continue;
        if (entry.name === "lesson-design.validation.ts" || entry.name === "learning-work-generation.ts") continue;
        offenders.push(entry.name);
      }
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], "only the generation path may consume the design validator");
});

// 5.2 回归：十段正文的分隔线与答案分区不变。
test("the ten-section body keeps answers below the separator and the blind solve slice stops at the transfer task", () => {
  const content = tenSections();
  const body = solvabilityBody(content);
  assert.match(body, /练习/);
  assert.doesNotMatch(body, /迁移任务|参考分析/);
  const input = solvabilityInput(design() as any, content, [{ title: source.title, content: source.text, digest: "d".repeat(64), source: { kind: "text" } }]);
  assert.equal(input.approved_sources.length, 1);
  assert.throws(() => parseSolvability({ ...unsolvable, missing_conditions: [] }), { statusCode: 422 });
  assert.throws(() => parseSolvability({ ...solvable, confidence: 1.4 }), { statusCode: 422 });
  assert.deepEqual(parseSolvability(solvable), solvable);
});