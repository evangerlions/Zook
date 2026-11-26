import assert from "node:assert/strict";
import test from "node:test";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { prepareLearningGeneration } from "../../src/modules/lighttick/learning/learning-work-generation.ts";
import type { LearningWork } from "../../src/modules/lighttick/learning/learning-work.types.ts";

const now = "2026-11-26T00:00:00.000Z";
const prior = [
  { number: 1, topic: "结论先行", goal: "先说结果再说过程", assessment: "改写开头为结论句" },
  { number: 2, topic: "量化工作成果", goal: "把形容词换成可测指标", assessment: "给出指标与来源" },
];
function lessonWork(kind: "review" | "lesson", withPrior: boolean): LearningWork {
  return {
    appId: "lighttick", userId: "user-review-ctx", id: "work-review-ctx", routeId: "plan-a", kind: "lesson_draft",
    status: "running", revision: 1, epoch: 1, baseRouteRevision: 2, fence: "fence", attempt: 1, output: null,
    reservedMicros: 450000, errorCode: null, leaseUntil: now, createdAt: now, updatedAt: now,
    input: {
      number: 3, brief: { title: "测量课程", goal: "讲清进展", level: "零基础", minutes: 8 },
      lesson: { number: 3, kind, topic: "全流程复盘", goal: "整合应用前两课", exercise: "按素材改写并标注依据", minutes: 8 },
      ...(withPrior ? { prior_lessons: prior } : {}),
    },
  };
}
function userText(work: LearningWork) {
  return prepareLearningGeneration(work, [], LIGHTTICK_AI_SCENES.learning_lesson).request.messages[1].content as string;
}

test("复习课把前序课节要点带进输入，并要求正文先复述标准", () => {
  const user = userText(lessonWork("review", true));
  assert.match(user, /prior_lessons lists the published lessons before this review lesson/);
  // 规则要求「标准先写进正文，练习只许引用正文定义过的标准」，这是复习课可解的充要条件。
  assert.match(user, /The exercise may only cite standards this teaching body defines/);
  assert.match(user, /"prior_lessons"/);
  assert.match(user, /结论先行/);
});

test("普通课不注入复习课规则，但要给出正文字数配额", () => {
  const user = userText(lessonWork("lesson", true));
  assert.ok(!user.includes("prior_lessons lists the published lessons before this review lesson"));
  // 蓝图 8 分钟 → 200 字/分 配额 1600 字，欠载才不会每次都靠定向修复。
  assert.match(user, /needs roughly 1600 Chinese characters above the divider/);
});

test("复习课缺少前序要点时按普通课处理，不编造规则", () => {
  const user = userText(lessonWork("review", false));
  assert.ok(!user.includes("prior_lessons lists the published lessons before this review lesson"));
});

test("定向修复带上上一稿正文，要求只在原稿上补写", () => {
  const prepared = prepareLearningGeneration(lessonWork("lesson", true), [], LIGHTTICK_AI_SCENES.learning_lesson,
    ["Lesson workload 8.5 minutes is below 9.5 minutes"], "## 引导问题\n旧稿正文");
  const user = prepared.request.messages[1].content as string;
  assert.match(user, /previous_draft holds what you already wrote/);
  assert.match(user, /旧稿正文/);
  assert.match(user, /"previous_draft"/);
});

test("只会整体重出时不给补写指令，避免伪造上下文", () => {
  const prepared = prepareLearningGeneration(lessonWork("lesson", true), [], LIGHTTICK_AI_SCENES.learning_lesson,
    ["Lesson workload 8.5 minutes is below 9.5 minutes"]);
  const user = prepared.request.messages[1].content as string;
  assert.ok(!user.includes("previous_draft holds what you already wrote"));
  assert.ok(!user.includes('"previous_draft"'));
});

test("泄漏类修复不注入旧稿，否则答案句删不掉", () => {
  const prepared = prepareLearningGeneration(lessonWork("lesson", true), [], LIGHTTICK_AI_SCENES.learning_lesson,
    ["Lesson reference analysis repeats a decisive sentence in the visible body (\"鉴于用户活跃度与续费率双降…\")"], "## 引导问题\n旧稿正文");
  const user = prepared.request.messages[1].content as string;
  assert.ok(!user.includes('"previous_draft"'));
  assert.ok(!user.includes("旧稿正文"));
});
