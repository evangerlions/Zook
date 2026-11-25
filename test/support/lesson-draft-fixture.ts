import { readingMinutes } from "../../src/modules/lighttick/learning/lesson-design.validation.ts";

/**
 * 合成模型夹具：新课节必须带 `design` 与十段正文，并且能通过盲解。
 * 这些字段的取值从 INPUT_JSON 里的蓝图（`lesson`）读出，模仿真实模型读输入而非硬编码，
 * 这样同一夹具在 topic / minutes / kind 不同的路线上都成立。
 */
export type LessonBlueprintFixture = {
  number: number;
  topic: string;
  minutes: number;
  kind?: "lesson" | "review";
};

export function tenSectionBody(topic: string): string {
  return [
    `## 回忆检查\n1. 上一课里「${topic}」的判据是什么？\n2. 哪条依据必须可核对？`,
    `## 引导问题\n为什么要把「${topic}」说成可核对的一句话？`,
    `## 概念\n${topic} 的结论要建立在可核对的事实上。`,
    `## 示范\n第一步列出已核实事项，因为来源可复查；第二步标注待核实事项，因为来源尚未确认。`,
    `## 边界\n不把未知说成已确认。`,
    `## 练习\n用一条已核实事实写一句关于「${topic}」的判断。完成标准：至少含一条已核实事实与一条待核实事项。`,
    `## 迁移任务\n换一个场景，再写一次关于「${topic}」的进度说明。`,
    `---`,
    `## 参考分析\n只有已核对的事项可以作为确定依据。`,
    `## 自查\n每条依据是否有明确对象？`,
    `## 记忆提示\n事实与判断分开。`,
  ].join("\n\n");
}

/** 依据蓝图折算工作量：练习分钟补到蓝图预算，使偏差接近 0，而不是让夹具靠容差勉强通过。 */
export function compliantLessonDraft(blueprint: LessonBlueprintFixture, references: string) {
  const content = tenSectionBody(blueprint.topic);
  const read = readingMinutes(content).minutes;
  const practice = Math.max(0, Math.min(240, Math.round(blueprint.minutes - read)));
  return {
    content,
    references,
    design: {
      primary_concept: blueprint.topic,
      objective: `写出一句关于「${blueprint.topic}」的进度说明，并区分已核实与待核实事项`,
      concepts_used: [blueprint.topic],
      estimated_read_minutes: Math.max(1, Math.round(read)),
      estimated_practice_minutes: practice,
      exercise_rubric: ["事实可核对", "区分待核实事项"],
      covers: blueprint.kind === "review" ? [Math.max(1, blueprint.number - 1)] : [],
    },
  };
}

export function syntheticSolvabilityVerdict() {
  return { answerable: true, missing_conditions: [], expected_points: ["一条已核实事实", "一条待核实事项"], confidence: 0.9 };
}

/**
 * 按 INPUT_JSON 的形状分派两个学习场景：
 * 带 `teaching_body` 的是盲解检查，带 `lesson` 的是课节生成；其余场景返回 null 交给调用方。
 */
export function syntheticLearningOutput(input: Record<string, any> | null): unknown | null {
  if (!input) return null;
  if (input.teaching_body !== undefined) return syntheticSolvabilityVerdict();
  if (input.lesson) {
    const blueprint = input.lesson as LessonBlueprintFixture;
    const references = String(input.sources?.[0]?.title ?? "明确上传的合成资料");
    return compliantLessonDraft(blueprint, references);
  }
  return null;
}

/** 从合成模型的 user 消息里取 INPUT_JSON；取不到返回 null。 */
export function syntheticInputFrom(prompt: string): Record<string, any> | null {
  if (!prompt.includes("INPUT_JSON=")) return null;
  try {
    return JSON.parse(prompt.split("INPUT_JSON=").at(-1)!);
  } catch {
    return null;
  }
}