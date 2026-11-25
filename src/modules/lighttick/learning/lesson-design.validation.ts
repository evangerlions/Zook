import { fail, integer, keys, object, text } from "./native-learning.validation.ts";
import { lessonRegions } from "./lesson-code-gates.ts";

/**
 * AI 课程设计质量门（improve-ai-course-design-quality 2.1–2.5）。
 *
 * 兼容契约（2.6）：`design` 在输出 schema 中**可选**。
 * - 有 design：跑完整质量门，并要求十段标题。
 * - 无 design：沿用「八段 + 分隔线」的最低要求，人工编辑与旧正文不因此被判非法。
 * 提示词（1.3）要求模型必须输出 design，因此真实生成会走完整门禁。
 */

/** 十段中新增的两段。其余八段是历史最低要求，保持不动。 */
export const LESSON_DESIGN_SECTIONS = ["回忆检查", "迁移任务"] as const;
/** 历史八段，任何课节正文都必须包含。 */
export const LESSON_BASE_SECTIONS = ["引导问题", "概念", "示范", "边界", "练习", "参考分析", "自查", "记忆提示"] as const;

const CJK_CHARS_PER_MINUTE = 350;
const LATIN_WORDS_PER_MINUTE = 200;
const WORKLOAD_TOLERANCE = 0.3;
/** 短课固定开销：分隔线、十段标题、回忆检查与迁移任务，合计约 5 分钟，与正文长度无关。 */
const SHORT_LESSON_SLACK_MINUTES = 5;

/** 可观察行为动词：目标必须落到能核对的动作上，而不是「了解 / 熟悉」。 */
const OBSERVABLE_VERBS = [
  "写出", "列出", "计算", "判断", "比较", "说明", "演示", "完成", "提交", "标注",
  "选择", "修正", "复述", "绘制", "实现", "测量", "排序", "归纳", "改写", "指出",
  "填空", "解答", "分类", "核对", "复盘", "搭建", "调试", "翻译", "背诵", "默写",
  "write", "list", "compute", "calculate", "judge", "compare", "explain", "demonstrate",
  "complete", "submit", "label", "choose", "select", "correct", "revise", "draw",
  "implement", "measure", "sort", "classify", "verify", "build", "debug", "translate",
];

/**
 * 以「了解 / 熟悉」这类内部状态动词开头，就不是可观察目标。
 * 必须单独判开头：`熟悉进度说明` 里的「说明」是宾语名词，只做子串匹配会把它误当行为动词。
 */
const VAGUE_LEAD = /^(了解|熟悉|理解|掌握|知道|认识|understand|get familiar|learn about|be familiar)/i;

export const LESSON_DESIGN_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["primary_concept", "objective", "concepts_used", "estimated_read_minutes",
    "estimated_practice_minutes", "exercise_rubric", "covers"],
  properties: {
    primary_concept: { type: "string", minLength: 2, maxLength: 200 },
    objective: { type: "string", minLength: 1, maxLength: 1000 },
    concepts_used: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 200 } },
    estimated_read_minutes: { type: "integer", minimum: 1, maximum: 240 },
    estimated_practice_minutes: { type: "integer", minimum: 0, maximum: 240 },
    exercise_rubric: { type: "array", minItems: 2, maxItems: 8, items: { type: "string", minLength: 1, maxLength: 400 } },
    covers: { type: "array", maxItems: 364, items: { type: "integer", minimum: 1, maximum: 364 } },
  },
};

export interface LessonBlueprint {
  number: number; topic: string; goal: string; minutes: number; kind: "lesson" | "review";
}

/** 可见区：分隔线之上的教学内容；参考分析在分隔线之下。 */
export function lessonVisibleRegion(content: string): string {
  return lessonRegions(content).visible;
}

/** 阅读分钟：CJK 按字符、拉丁按词分别折算后相加，保留一位小数。 */
export function readingMinutes(content: string): { cjk: number; latin: number; minutes: number } {
  const cjk = (content.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latin = (content.replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g, " ")
    .match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
  const minutes = Math.round((cjk / CJK_CHARS_PER_MINUTE + latin / LATIN_WORDS_PER_MINUTE) * 10) / 10;
  return { cjk, latin, minutes };
}

function stringArray(value: unknown, max: number, label: string): string[] {
  if (!Array.isArray(value) || value.length > max) fail(422, `${label} must be a bounded list.`);
  return value.map(entry => text(entry, 400, true));
}

/**
 * 校验 design 块并返回可留档的核算结果。任一失败都给出可定向修复的原因，
 * 不改写模型正文、不放宽标准、不静默通过。
 */
export function validateLessonDesign(raw: unknown, blueprint: LessonBlueprint, content: string) {
  const design = object(raw);
  keys(design, ["primary_concept", "objective", "concepts_used", "estimated_read_minutes",
    "estimated_practice_minutes", "exercise_rubric", "covers"]);

  // 2.2 主概念：必须是蓝图 topic 的开头，且本身是个概念而非单字。两者缺一都能靠「的」「是」这类碎片骗过门禁。
  const primaryConcept = text(design.primary_concept, 200, true).trim();
  const cjkLength = (primaryConcept.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latinWords = (primaryConcept.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
  if (cjkLength < 2 && latinWords < 1) {
    fail(422, "Lesson primary_concept must name a concept: at least two Chinese characters or one English word.");
  }
  if (!blueprint.topic.trim().startsWith(primaryConcept)) {
    fail(422, `Lesson primary_concept must open the blueprint topic "${blueprint.topic}"; teach that one concept and keep it leading.`);
  }

  // 2.3 目标：必须含可观察行为动词，「了解 / 熟悉」这类不可核对的表述判失败。
  const objective = text(design.objective, 1000, true);
  const lower = objective.toLowerCase();
  if (VAGUE_LEAD.test(objective.trim()) || !OBSERVABLE_VERBS.some(verb => lower.includes(verb))) {
    fail(422, "Lesson objective must name an observable action and its checkable result, not only 了解/熟悉.");
  }

  const conceptsUsed = stringArray(design.concepts_used, 12, "concepts_used");

  // 2.4 练习评分维度与复习覆盖。
  const rubric = stringArray(design.exercise_rubric, 8, "exercise_rubric");
  if (rubric.length < 2) fail(422, "Lesson exercise_rubric needs at least two non-empty scoring dimensions.");
  if (!Array.isArray(design.covers)) fail(422, "Lesson covers must be a list of earlier lesson numbers.");
  const covers = design.covers.map(entry => integer(entry, 1, 364));
  if (blueprint.kind === "review") {
    if (covers.length === 0) fail(422, "A review lesson must list which earlier lessons it covers.");
    if (covers.some(number => number >= blueprint.number)) {
      fail(422, "A review lesson may cover only earlier lesson numbers.");
    }
  } else if (covers.length > 0) {
    fail(422, "An ordinary lesson must leave covers empty.");
  }

  // 2.5 工作量核算：只折算分隔线之上的可见区阅读分钟 + 声明练习分钟。
  // 参考分析是做完题之后的订正材料，不属于首次阅读，计入会把短课系统性地判超载。
  // 容差下界固定 −30%；上界取「+30%」与「+5 分钟固定开销」中更大者，短课因此不再被十段骨架压死。
  const declaredRead = integer(design.estimated_read_minutes, 1, 240);
  const practice = integer(design.estimated_practice_minutes, 0, 240);
  const read = readingMinutes(lessonVisibleRegion(content));
  const total = Math.round((read.minutes + practice) * 10) / 10;
  const deviation = Math.round((total / blueprint.minutes - 1) * 1000) / 1000;
  const upperMinutes = Math.max(blueprint.minutes * (1 + WORKLOAD_TOLERANCE), blueprint.minutes + SHORT_LESSON_SLACK_MINUTES);
  const lowerMinutes = blueprint.minutes * (1 - WORKLOAD_TOLERANCE);
  const toleranceUpper = Math.round((upperMinutes / blueprint.minutes - 1) * 1000) / 1000;
  if (total > upperMinutes || total < lowerMinutes) {
    fail(422, `Lesson workload ${total} minutes is outside ${lowerMinutes}–${upperMinutes} minutes for the blueprint ${blueprint.minutes} minutes; compress the scope, not the title.`);
  }

  return {
    primary_concept: primaryConcept,
    objective,
    concepts_used: conceptsUsed,
    exercise_rubric: rubric,
    covers: [...new Set(covers)].sort((a, b) => a - b),
    design_check: {
      cjk_characters: read.cjk,
      latin_words: read.latin,
      computed_read_minutes: read.minutes,
      declared_read_minutes: declaredRead,
      estimated_practice_minutes: practice,
      total_minutes: total,
      blueprint_minutes: blueprint.minutes,
      workload_deviation: deviation,
      tolerance: WORKLOAD_TOLERANCE,
      tolerance_upper: toleranceUpper,
    },
  };
}