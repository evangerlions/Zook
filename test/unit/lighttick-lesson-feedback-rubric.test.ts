import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { teachingPadding } from "../support/lesson-draft-fixture.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import {
  WorkReportPracticeService,
  REPORT_PROMPT,
  REPORT_RUBRIC,
  lessonReportRubric,
  normalizeReportRubric,
  reportQuoteOptions,
  reportQuoteSchema,
  validateReportFeedback,
} from "../../src/modules/lighttick/learning/work-report-practice.ts";

/**
 * 3.1／3.2／3.4：反馈按本课 rubric 判定。
 * read 与 submit 必须来自同一份发布态 design；历史课节显式回落通用工作汇报 rubric，
 * 判定数量、维度集合随 rubric 走，met 仍需提交稿的精确子串。
 */

const owner = { appId: "lighttick", userId: "lesson-rubric-owner" };
const blueprint = { number: 1, topic: "First steps", goal: "写出一句进度说明", minutes: 15, kind: "lesson" as const };
const content = [
  "## 引导问题\n为什么要分开说？",
  "## 回忆检查\n1. 什么算可核对的事实？",
  "## 概念\n结论要建立在可核对的事实上。",
  "## 示范\n先列事实，再下判断。",
  "## 边界\n不把未知说成已确认。",
  "## 练习\n写一句进度说明。完成标准：含一条已核实事实。",
  "## 迁移任务\n换个场景再写一次。",
  `## 展开\n${teachingPadding(520)}`,
  "---",
  "## 参考分析\n只有已核对的事项可以作为确定依据。",
  "## 自查\n每条依据是否有对象？",
  "## 记忆提示\n事实与判断分开。",
].join("\n\n");
const submission = "进度正常。已完成接口联调，待核实压测结论。";
function design(rubric: Array<{ title: string; standard: string }>) {
  return {
    primary_concept: "First",
    objective: "写出一句含已核实与待核实事项的进度说明",
    concepts_used: ["First"],
    estimated_read_minutes: 1,
    estimated_practice_minutes: 14,
    // 发布态 design 的维度 id 由服务端生成，这里模拟已冻结的记录。
    exercise_rubric: rubric.map((criterion, index) => ({ id: `c${index + 1}`, ...criterion })),
    covers: [],
  };
}
const twoDimensions = [
  { title: "事实可核对", standard: "至少一条事实能追到来源。" },
  { title: "区分待核实", standard: "待核实事项单独标注。" },
];
const threeDimensions = [
  { title: "结论先行", standard: "开头说明进度状态。" },
  { title: "事实支撑", standard: "至少一条已核实事实。" },
  { title: "风险说明", standard: "说明未核实项的影响。" },
];
async function setup() {
  const repo = new InMemoryLightTickRepository();
  const native = new NativeLearningService(repo, true);
  const work = new LearningWorkService(new LearningRouteService(native), new InMemoryJobQueue());
  await native.saveCollection(owner, "rubric-course", { title: "Learn", archived: false, base_revision: 0 }, "rubric-collection");
  return { repo, native, work, service: new WorkReportPracticeService(work) };
}
async function publish(
  native: NativeLearningService,
  id: string,
  body: { base_revision: number; title: string; content: string; design: Record<string, unknown> },
  key: string,
) {
  return native.publish(
    owner,
    id,
    { ...body, collection_id: "rubric-course", number: 1, references: "", source_url: "" },
    key,
    undefined,
    { routeId: "rubric-course", number: 1, blueprint },
  );
}
const checksFor = (rubric: { criteria: { id: string }[] }, quote = submission) => ({
  checks: rubric.criteria.map((c) => ({
    criterion_id: c.id,
    status: "met",
    quote,
    explanation: "任务层：引用段落满足了这条标准。过程层：先列事实再下判断。",
    suggestion: "下次先核对来源再写结论。",
  })),
});

test("a designed lesson judges against its own rubric on both read and submit", async () => {
  const f = await setup();
  const published = await publish(f.native, "lesson-rubric-one", { base_revision: 0, title: "First steps", content, design: design(threeDimensions) }, "rubric-publish-one");

  const read = await f.service.read(owner, published.id, published.content_version);
  assert.equal(read.rubric.id, "lesson-exercise-1");
  assert.equal(read.rubric.title, "First steps");
  assert.deepEqual(read.rubric.criteria.map((c) => c.id), ["c1", "c2", "c3"]);

  await f.service.submit(
    owner,
    published.id,
    { content_version: published.content_version, submission, parent_id: null, consent: true },
    "rubric-submit-one",
    async () => {},
  );
  const after = await f.service.read(owner, published.id, published.content_version);
  assert.deepEqual(after.attempts[0].rubric.criteria.map((c) => c.id), ["c1", "c2", "c3"], "attempt 冻结本课 rubric");
  assert.equal(after.attempts[0].rubric.id, read.rubric.id, "读路径与写入快照同一口径");
});

test("a legacy lesson without design falls back to the work report rubric and labels it", async () => {
  const f = await setup();
  const published = await f.native.publish(
    owner,
    "lesson-rubric-legacy",
    { base_revision: 0, collection_id: "rubric-course", number: 1, title: "三分钟工作汇报", content, references: "", source_url: "" },
    "rubric-publish-legacy",
  );
  const read = await f.service.read(owner, published.id, published.content_version);
  assert.equal(read.rubric.id, "work-report-v1");
  assert.deepEqual(read.rubric.criteria.map((c) => c.id), REPORT_RUBRIC.criteria.map((c) => c.id));

  const feedback = validateReportFeedback(checksFor(REPORT_RUBRIC), submission);
  assert.equal(feedback.rubric_id, "work-report-v1", "回落必须在反馈里标明 rubric_id");
});

test("criterion count and ids follow the rubric, never the legacy four", () => {
  const rubric = lessonReportRubric({ number: 7, title: "练习" }, design(twoDimensions));
  assert.equal(rubric.criteria.length, 2);
  const two = validateReportFeedback(checksFor(rubric), submission, rubric);
  assert.equal(two.checks.length, 2);
  assert.equal(two.rubric_id, "lesson-exercise-7");

  assert.throws(() => validateReportFeedback(checksFor(REPORT_RUBRIC), submission, rubric), "四条不能冒充本课两条");
  assert.throws(() =>
    validateReportFeedback(
      { checks: [{ ...checksFor(rubric).checks[0], criterion_id: "conclusion" }, checksFor(rubric).checks[1]] },
      submission,
      rubric,
    ),
    "本课 rubric 之外的维度必须拒绝",
  );
  assert.throws(() =>
    validateReportFeedback({ checks: [checksFor(rubric).checks[0], checksFor(rubric).checks[0]] }, submission, rubric),
  );
  assert.throws(() =>
    validateReportFeedback(
      { checks: [{ ...checksFor(rubric).checks[0], quote: "未出现在稿件里的句子" }, checksFor(rubric).checks[1]] },
      submission,
      rubric,
    ),
    "met 仍必须是提交稿精确子串",
  );
  assert.throws(() =>
    validateReportFeedback(
      { checks: [{ ...checksFor(rubric).checks[0], status: "met", quote: "" }, checksFor(rubric).checks[1]] },
      submission,
      rubric,
    ),
    "met 不得留空 quote",
  );
});

test("the output schema is sized to the rubric so the model cannot add or drop criteria", () => {
  const rubric = lessonReportRubric({ number: 3, title: "练习" }, design(threeDimensions));
  const options = reportQuoteOptions(submission);
  const schema: any = reportQuoteSchema(options, rubric);
  assert.equal(schema.properties.checks.minItems, 3);
  assert.equal(schema.properties.checks.maxItems, 3);
  assert.deepEqual(schema.properties.checks.items.properties.criterion_id.enum, ["c1", "c2", "c3"]);
  assert.ok(schema.properties.checks.items.required.includes("quote_id"));
});

test("stored rubric snapshots are reused and an invalid snapshot fails loudly", () => {
  const rubric = lessonReportRubric({ number: 2, title: "练习" }, design(twoDimensions));
  assert.deepEqual(normalizeReportRubric(structuredClone(rubric)), rubric);
  assert.deepEqual(normalizeReportRubric(undefined), REPORT_RUBRIC, "缺席才是历史回落");
  assert.throws(() => normalizeReportRubric({ id: "x", title: "t", task: "", criteria: [] }), "空维度不得静默换 rubric");
  assert.throws(() => normalizeReportRubric({ id: "x", title: "t", task: "", criteria: [{ id: "c1", title: "a", standard: "b" }] }));
});

test("the review prompt states the three Hattie layers and forbids judging the person", () => {
  for (const phrase of ["task layer", "process layer", "self-regulation layer"]) assert.ok(REPORT_PROMPT.includes(phrase), phrase);
  assert.match(REPORT_PROMPT, /never judge the person/i);
  assert.doesNotMatch(REPORT_PROMPT, /Cover conclusion, evidence, risk, request/i);
});

test("a republished lesson keeps each version on the rubric it was published with", async () => {
  const f = await setup();
  const first = await publish(f.native, "lesson-rubric-two", { base_revision: 0, title: "First steps", content, design: design(threeDimensions) }, "rubric-publish-two");
  const changed = content.replace("先列事实，再下判断。", "先列已核实事实，再写待核实事项。");
  const second = await publish(f.native, first.id, { base_revision: 1, title: "First steps", content: changed, design: design(twoDimensions) }, "rubric-publish-three");
  assert.notEqual(second.content_version, first.content_version);

  const oldRead = await f.service.read(owner, first.id, first.content_version);
  const newRead = await f.service.read(owner, first.id, second.content_version);
  assert.equal(oldRead.rubric.criteria.length, 3, "旧版本的完成标准不随改版漂移");
  assert.equal(newRead.rubric.criteria.length, 2);
  await f.service.submit(
    owner,
    first.id,
    { content_version: second.content_version, submission, parent_id: null, consent: true },
    "rubric-submit-two",
    async () => {},
  );
  const attempt = (await f.service.read(owner, first.id, second.content_version)).attempts[0];
  assert.equal(attempt.rubric.criteria.length, 2, "提交按该版本 rubric 快照判定");
});
