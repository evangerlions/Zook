import { fail, keys, object, text } from "./native-learning.validation.ts";
import type { LearningSource } from "./learning-work.types.ts";

/**
 * 课节盲解检查（improve-ai-course-design-quality 3.1–3.4）。
 *
 * 用第二次模型调用，只拿「目标 + 评分标准 + 回忆检查至练习的正文 + 允许来源摘要」
 * 判断题面是否自足可解。参考分析、自查、记忆提示一律不进入输入，否则检查会被答案喂穿。
 * 结论只写进 work 输出留档，不进入阅读器正文。
 */

export const SOLVABILITY_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false,
  required: ["answerable", "missing_conditions", "expected_points", "confidence"],
  properties: {
    answerable: { type: "boolean" },
    missing_conditions: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 400 } },
    expected_points: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 400 } },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    // 4.3：可选扩展。盲解者按本课材料独立作答的结果，只用于闭合题的答案一致性比对（B2，未启用）。
    // 开放题可以不给；缺席不是失败，给了才校验格式。
    solved_answer: { type: "string", maxLength: 1200 },
    // 题干自身的缺陷（条件互相矛盾、选项不含正确答案等），与「材料缺失」分开记录。
    item_flaws: { type: "array", maxItems: 8, items: { type: "string", minLength: 1, maxLength: 400 } },
  },
};

export interface SolvabilityVerdict {
  answerable: boolean;
  missing_conditions: string[];
  expected_points: string[];
  confidence: number;
  /** 4.3：闭合题盲解得到的独立答案；开放题缺席。 */
  solved_answer?: string;
  /** 4.3：练习题目身的缺陷；与 missing_conditions（材料缺失）分开。 */
  item_flaws?: string[];
}

const MAX_SOURCES = 4;
// 只截来源摘要，绝不截教学正文：正文是被裁决的对象，截断会造出假的「不可解」。
const SOURCE_EXCERPT = 600;

/** 回忆检查（含）到迁移任务（不含）之间的正文；没有迁移任务时切到分隔线。 */
export function solvabilityBody(content: string): string {
  const start = content.search(/^ {0,3}#{1,6}[ \t]+回忆检查/m);
  if (start < 0) fail(422, "Lesson recall check section is required before the blind solve check.");
  const rest = content.slice(start);
  const transfer = rest.search(/^ {0,3}#{1,6}[ \t]+迁移任务/m);
  const separator = rest.search(/^ {0,3}---[ \t]*$/m);
  const ends = [transfer, separator].filter(index => index > 0);
  return ends.length ? rest.slice(0, Math.min(...ends)).trim() : rest.trim();
}

/** 3.2 输入裁剪：只给判断可解性所必需的材料。 */
export function solvabilityInput(
  design: { objective: string; exercise_rubric: Array<{ title: string; standard: string }> },
  content: string,
  sources: LearningSource[],
) {
  return {
    objective: design.objective,
    // 盲解只需要判定口径，不把服务端 c1..cN 的编号喂给模型。
    exercise_rubric: design.exercise_rubric.map(criterion =>
      criterion.title === criterion.standard ? criterion.title : `${criterion.title}：${criterion.standard}`),
    teaching_body: solvabilityBody(content),
    approved_sources: sources.slice(0, MAX_SOURCES).map(source => ({
      title: source.title,
      digest: source.digest,
      excerpt: source.content.slice(0, SOURCE_EXCERPT),
    })),
  };
}

/** 3.3 输出校验：不可解必须给出可定向修复的缺失条件，否则判失败而不是放行。 */
export function parseSolvability(raw: unknown): SolvabilityVerdict {
  const value = object(raw);
  keys(value, ["answerable", "missing_conditions", "expected_points", "confidence", "solved_answer", "item_flaws"]);
  if (typeof value.answerable !== "boolean") fail(422, "Blind solve check must return a boolean answerable.");
  if (!Array.isArray(value.missing_conditions) || !Array.isArray(value.expected_points)) {
    fail(422, "Blind solve check must return missing_conditions and expected_points lists.");
  }
  const missing = value.missing_conditions.map(entry => text(entry, 400, true));
  const expected = value.expected_points.map(entry => text(entry, 400, true));
  if (missing.length > 8 || expected.length > 8) fail(422, "Blind solve check returned too many entries.");
  const confidence = Number(value.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
    fail(422, "Blind solve confidence must be between 0 and 1.");
  }
  if (!value.answerable && missing.length === 0) {
    fail(422, "An unsolvable lesson must name the missing conditions.");
  }
  // 4.3 可选成员：缺席即不产出该键，不给下游留空洞字段；给了就必须是可用文本。
  const solved = value.solved_answer === undefined ? "" : text(value.solved_answer, 1200, false).trim();
  let flaws: string[] | undefined;
  if (value.item_flaws !== undefined) {
    if (!Array.isArray(value.item_flaws) || value.item_flaws.length > 8)
      fail(422, "Blind solve item_flaws must be a list of at most eight entries.");
    flaws = value.item_flaws.map(entry => text(entry, 400, true));
  }
  return {
    answerable: value.answerable,
    missing_conditions: missing,
    expected_points: expected,
    confidence,
    ...(solved ? { solved_answer: solved } : {}),
    ...(flaws ? { item_flaws: flaws } : {}),
  };
}