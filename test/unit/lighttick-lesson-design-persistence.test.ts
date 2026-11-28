import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { teachingPadding } from "../support/lesson-draft-fixture.ts";

/**
 * 2.1／2.3：发布态 design 冻结。
 * 设计记录必须与 content_version 一一对应：正文改版产生新记录，旧记录不可变；
 * 评分维度 id 由服务端生成 c1..cN，模型自造 id 一律丢弃。
 */

const owner = { appId: "lighttick" as const, userId: "design-owner" };
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
function design(extra: Record<string, unknown> = {}) {
  return {
    primary_concept: "First",
    objective: "写出一句含已核实与待核实事项的进度说明",
    concepts_used: ["First"],
    estimated_read_minutes: 1,
    estimated_practice_minutes: 14,
    exercise_rubric: [
      // 模型自造的 id 不应被采信。
      { id: "model-made-up", title: "事实可核对", standard: "至少一条事实能追到来源。" },
      { id: "c9", title: "区分待核实事项", standard: "待核实事项单独标注。" },
    ],
    covers: [],
    ...extra,
  };
}

async function setup() {
  const repo = new InMemoryLightTickRepository();
  const service = new NativeLearningService(repo, true);
  await service.saveCollection(owner, "collection-design", { title: "Learn", archived: false, base_revision: 0 }, "collection-design-create");
  return { repo, service };
}

test("publishing a designed lesson freezes its design under the content version", async () => {
  const { repo, service } = await setup();
  const row = await service.publish(
    owner,
    "lesson-design-one",
    { base_revision: 0, collection_id: "collection-design", number: 1, title: "First steps", content, references: "", source_url: "", design: design() },
    "design-publish-one",
    undefined,
    { routeId: "collection-design", number: 1, blueprint },
  );
  const record = await repo.getLessonDesign(owner, row.id, row.content_version);
  assert.ok(record, "design 必须随发布写入");
  assert.equal(record.contentVersion, row.content_version);
  const stored = record.design as Record<string, any>;
  assert.deepEqual(stored.exercise_rubric.map((criterion: any) => criterion.id), ["c1", "c2"], "服务端按顺序生成 c1..cN");
  assert.equal(stored.exercise_rubric[0].title, "事实可核对");
  assert.equal(stored.design_check.blueprint_minutes, 15, "核算结果随 design 一起冻结");
  assert.equal((await service.lessonDesign(owner, row.id, row.content_version))?.primary_concept, "First");
});

test("a re-published lesson keeps the old design record and writes a new one", async () => {
  const { repo, service } = await setup();
  const first = await service.publish(
    owner,
    "lesson-design-two",
    { base_revision: 0, collection_id: "collection-design", number: 1, title: "First steps", content, references: "", source_url: "", design: design() },
    "design-publish-two",
    undefined,
    { routeId: "collection-design", number: 1, blueprint },
  );
  const changed = content.replace("先列事实，再下判断。", "先列已核实事实，再写待核实事项。");
  const second = await service.publish(
    owner,
    first.id,
    { base_revision: 1, collection_id: "collection-design", number: 1, title: "First steps", content: changed, references: "", source_url: "", design: design() },
    "design-publish-three",
    undefined,
    { routeId: "collection-design", number: 1, blueprint },
  );
  assert.notEqual(second.content_version, first.content_version);
  const old = await repo.getLessonDesign(owner, first.id, first.content_version);
  const fresh = await repo.getLessonDesign(owner, first.id, second.content_version);
  assert.ok(old && fresh, "两个版本各有一条记录");
  assert.equal(old.contentVersion, first.content_version, "旧记录不被新版本覆盖");
  assert.equal(fresh.contentVersion, second.content_version);
});

test("a manually published lesson without design stays publishable and has no design record", async () => {
  const { repo, service } = await setup();
  const row = await service.publish(
    owner,
    "lesson-design-legacy",
    { base_revision: 0, collection_id: "collection-design", number: 1, title: "Legacy", content: "Original lesson", references: "", source_url: "" },
    "design-publish-legacy",
  );
  assert.equal(await repo.getLessonDesign(owner, row.id, row.content_version), undefined, "无 design 的历史课节不编造记录");
  assert.equal(await service.lessonDesign(owner, row.id), undefined, "读路径显式回落为无设计");
});

test("a design published outside its course blueprint is refused instead of stored unchecked", async () => {
  const { service } = await setup();
  await assert.rejects(
    service.publish(
      owner,
      "lesson-design-noblue",
      { base_revision: 0, collection_id: "collection-design", number: 1, title: "First steps", content, references: "", source_url: "", design: design() },
      "design-publish-noblue",
    ),
    (error: any) => error.statusCode === 409 && /blueprint/.test(error.message),
  );
});
