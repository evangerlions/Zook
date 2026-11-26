import { fail, integer, keys, object, text } from "./native-learning.validation.ts";
import { lessonRegions } from "./lesson-code-gates.ts";
import { ApplicationError } from "../../../shared/errors.ts";

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
/** 估算容差：读分钟与练习分钟都是模型自报，±1 分钟的估算噪声不该判死。
 *  真实语料：15 分钟课自然产出 9.9 分钟，贴 10.0 下界失败（差 6 秒）。
 *  正文空壳由 2.6 的实质门兜底（40 汉字/分钟），不靠收紧下界。 */
const LOWER_SLACK_MINUTES = 1;
/** 正文实质下界：只算可见区汉字。1 分钟课至少要有一句话的量，长课按 40 汉字/分钟累加。
 *  这条门拦的是「正文几乎是空壳、只靠声明练习时长凑够分钟」的课，不是替代工作量核算。 */
const SUBSTANCE_FLOOR_CJK = 300;
const SUBSTANCE_CJK_PER_MINUTE = 40;
/** 短课固定开销：分隔线、十段标题、回忆检查与迁移任务，合计约 5 分钟，与正文长度无关。 */
const SHORT_LESSON_SLACK_MINUTES = 5;

// 可观察行为动词：目标必须落到能核对的动作上，而不是「了解 / 熟悉」。
// 表按实际生成语料补全（2026-11-25 实测：objective「能将…重写为…」因「重写」缺席被误杀），
// 但「了解 / 熟悉 / 理解 / 掌握 / 知道 / 认识」永远不进表——它们无法核对。
const OBSERVABLE_VERBS = [
  "写出", "列出", "计算", "判断", "比较", "说明", "演示", "完成", "提交", "标注",
  "选择", "修正", "复述", "绘制", "实现", "测量", "排序", "归纳", "改写", "指出",
  "填空", "解答", "分类", "核对", "复盘", "搭建", "调试", "翻译", "背诵", "默写",
  "重写", "概括", "总结", "梳理", "拆分", "识别", "提取", "起草", "修改", "组织",
  "设计", "编写", "描述", "说出", "举出", "举例", "阐述", "解释", "提问", "回答",
  "对比", "校验", "演算", "推理", "标注", "归档", "校对",
  "口述", "陈述", "讲解", "汇报", "介绍", "朗读", "说清", "讲清", "拟写", "拆解",
  "推演", "估算", "测算", "定位", "复现", "还原", "修订", "复核", "审阅", "评审",
  "评估", "量化", "列举", "枚举", "提炼", "沉淀", "建档", "串联", "重构", "标注",
  // 2026-11-25 实测补词：课程 B 第 4 节目标「将模糊的项目愿景转化为至少三个 SMART 目标」因「转化」缺席被拒。
  "转化", "转换", "转为", "落地", "对齐", "映射", "归并", "合并", "标准化", "模板化",
  "结构化", "拆成", "扩写", "缩写", "精简", "凝练", "命名", "排期", "复盘", "演练",
  "write", "list", "compute", "calculate", "judge", "compare", "explain", "demonstrate",
  "complete", "submit", "label", "choose", "select", "correct", "revise", "draw",
  "implement", "measure", "sort", "classify", "verify", "build", "debug", "translate",
  "rewrite", "summarize", "summarise", "outline", "draft", "edit", "identify", "extract",
  "organize", "describe", "answer", "justify", "prove", "map", "plan",
  "present", "narrate", "articulate", "estimate", "reproduce", "review", "critique",
];

/**
 * 以「了解 / 熟悉」这类内部状态动词开头，就不是可观察目标。
 * 必须单独判开头：`熟悉进度说明` 里的「说明」是宾语名词，只做子串匹配会把它误当行为动词；
 * 但后面给出了可执行承诺（能 / 会 / 并 …）时算合格目标，不因起头用词一刀切拒绝。
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
    exercise_rubric: { type: "array", minItems: 2, maxItems: 8, items: {
      type: "object", additionalProperties: false, required: ["title", "standard"],
      properties: { title: { type: "string", minLength: 1, maxLength: 200 }, standard: { type: "string", minLength: 1, maxLength: 400 } },
    } },
    covers: { type: "array", maxItems: 364, items: { type: "integer", minimum: 1, maximum: 364 } },
  },
};

export interface LessonBlueprint {
  number: number; topic: string; goal: string; minutes: number; kind: "lesson" | "review";
  /** 蓝图练习要求；主概念可以出自练习描述（例如「按结论先行改写这段文本」）。 */
  exercise?: string;
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

/** 评分维度：模型只给 title 与 standard，服务端按顺序补 id，保证同版本内唯一且稳定。 */
function exerciseRubric(value: unknown): Array<{ id: string; title: string; standard: string }> {
  if (!Array.isArray(value) || value.length < 2 || value.length > 8) {
    fail(422, "Lesson exercise_rubric needs two to eight scoring dimensions.");
  }
  const titles = new Set<string>();
  return value.map((entry, index) => {
    const item = object(entry);
    // 允许带回服务端 id（发布态 design 回传再校验），但一律按顺序重算 c1..c8，不采信任何传入 id。
    keys(item, ["title", "standard", "id"]);
    const title = text(item.title, 200, true), standard = text(item.standard, 400, true);
    if (titles.has(title)) fail(422, "Lesson exercise_rubric titles must be unique.");
    titles.add(title);
    return { id: `c${index + 1}`, title, standard };
  });
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
  // design_check 是上一次核算的留档：发布态 design 回传再校验时允许带上，值一律重算，不采信。
  keys(design, ["primary_concept", "objective", "concepts_used", "estimated_read_minutes",
    "estimated_practice_minutes", "exercise_rubric", "covers", "design_check"]);

  // 2.2 主概念：必须是蓝图 topic 的开头，且本身是个概念而非单字。两者缺一都能靠「的」「是」这类碎片骗过门禁。
  const primaryConcept = text(design.primary_concept, 200, true).trim();
  const cjkLength = (primaryConcept.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const latinWords = (primaryConcept.match(/[A-Za-z][A-Za-z'-]*/g) ?? []).length;
  if (cjkLength < 2 && latinWords < 1) {
    fail(422, "Lesson primary_concept must name a concept: at least two Chinese characters or one English word.");
  }
  // 概念必须出自蓝图认可的范围，但按字符串死盯 topic 会误杀合理选法：
  // 「金字塔原理在简报中的应用」这一节讲「结论先行」是正确的主概念，只是 phrase 不在 topic 里。
  // 因此允许匹配 topic、goal 或 exercise 任一处；三处都放不进才算跑题，且失败可定向重出并带上原话。
  const normalize = (value: string) => value.replace(/[\s，。、：:；;「」“”"（）()·\-]/g, "");
  const conceptFlat = normalize(primaryConcept);
  const blueprintScope = [blueprint.topic, blueprint.goal, blueprint.exercise ?? ""].map(normalize);
  // 语序变体不该判跑题：「痛点界定三要素」对蓝图 goal「…界定当前痛点」是同一件事，只是词序不同。
  // 因此除了子串，还接受与蓝图范围共享任意两字片段；完全不共享才算跑题。
  const sharesFragment = (concept: string, scope: string): boolean => {
    if (concept.length < 2) return scope.includes(concept);
    for (let i = 0; i + 2 <= concept.length; i += 1) if (scope.includes(concept.slice(i, i + 2))) return true;
    return false;
  };
  const matchesScope = blueprintScope.some(scope => scope.startsWith(conceptFlat) || scope.includes(conceptFlat) || sharesFragment(conceptFlat, scope));
  if (!matchesScope) {
    const message = `Lesson primary_concept "${primaryConcept}" is not part of the blueprint topic, goal or exercise ("${blueprint.topic}"); teach that one concept and keep it leading.`;
    throw new ApplicationError(422, "VALIDATION_ERROR", message, { lesson_code_gate: true, repair_targets: [message] });
  }

  // 2.3 目标：必须含可观察行为动词，「了解 / 熟悉」这类不可核对的表述判失败。
  const objective = text(design.objective, 1000, true);
  const lower = objective.toLowerCase();
  // 目标写错是可以修的：把原话带进拒绝理由，并允许一次定向重出，而不是让措辞随机性否决整节课。
  const objectiveFailure = (message: string): never => {
    const full = `Lesson objective "${objective.trim().slice(0, 80)}": ${message}`;
    throw new ApplicationError(422, "VALIDATION_ERROR", full, { lesson_code_gate: true, repair_targets: [full] });
  };
  // 只有「了解 / 熟悉」这类词、没有任何可观察行为动词，仍判失败。
  // 词表法永远会漏词，因此再加一条结构性放行：只要写明「将/把 某物 变成 可核对结果」，
  // 且结果本身带可核对标记（至少 / 每个 / 逐条 / 字 / 可被验证…），就视为可观察目标。
  const structuralPromise = /(将|把)/.test(objective)
    && /(可(被)?(独立)?(验证|核对|检查|判断)|至少|不超过|每个|每一项|逐条|逐项|字|个)/.test(objective);
  if (!OBSERVABLE_VERBS.some(verb => lower.includes(verb)) && !structuralPromise) {
    return objectiveFailure("state an observable action and its checkable result, not only 了解/熟悉.");
  }
  // 以模糊词起头时必须显式接上可执行承诺（能 / 会 / 可以 / 并 / 且 / 然后 …），
  // 否则「熟悉进度说明」这种把模糊词当成谓语的写法仍算不合格；
  // 「理解并能重写为…」这类给出可核对动作的目标则放行。
  if (VAGUE_LEAD.test(objective.trim()) && !/能|会|可以|并|且|然后|之后|通过/.test(objective)) {
    return objectiveFailure("a vague lead word must be followed by an executable commitment (能/会/并/且/然后).");
  }
  if (objective.trim().length < 8) {
    return objectiveFailure("it is too short to be checkable; name the action and its result.");
  }

  const conceptsUsed = stringArray(design.concepts_used, 12, "concepts_used");

  // 2.4 练习评分维度与复习覆盖。id 一律服务端生成 c1..c8，不采信模型自造 ID。
  const rubric = exerciseRubric(design.exercise_rubric);
  if (!Array.isArray(design.covers)) fail(422, "Lesson covers must be a list of earlier lesson numbers.");
  const covers = design.covers.map(entry => integer(entry, 1, 364));
  if (blueprint.kind === "review") {
    if (covers.length === 0) fail(422, "A review lesson must list which earlier lessons it covers.");
    if (covers.some(number => number >= blueprint.number)) {
      fail(422, "A review lesson may cover only earlier lesson numbers.");
    }
  } else if (covers.length > 0) {
    // 普通课节没有「复习覆盖」语义：模型偶尔会误填，按蓝图裁决为空即可。
    // 把这一字段变成发布失败，等于用随机性否定一份能教的课；复习课的覆盖校验保持严格。
    covers.splice(0, covers.length);
  }

  // 2.7 练习可判定：开放列举没有唯一答案，盲解判定必然判不可解并耗掉一次修复。
  // 真实语料：课程 A 第 5 节蓝图就是「找出五个常用的模糊形容词…」，连续两次判不可解。
  // 门拦的是正文练习段而不是蓝图原话——蓝图已由用户确认，生成侧必须把它落成
  // 「给定素材 + 每条可核对」的形态；给出具体清单的练习放行。
  const practiceSection = (() => {
    const visible = lessonVisibleRegion(content);
    const start = visible.search(/练习/);
    if (start < 0) return "";
    return visible.slice(start).split(/\n\s*#+\s*(?:参考分析|自查|记忆提示|迁移任务)/)[0];
  })();
  const openCollection = /(尽可能多|越多越好|找出\s*(?:五|5|若干|几|多)\s*个|举出\s*(?:五|5|若干|几|多)\s*个|列举\s*出?\s*(?:至少\s*)?(?:五|5|若干|几|多)\s*个|头脑风暴|集思广益|brainstorm|as many as)/i;
  const givenMaterial = /(给定|下面|以下|如下|材料|表格|例句|原文|清单|样例|附录)/;
  if (openCollection.test(practiceSection) && !givenMaterial.test(practiceSection)) {
    const message = `Lesson exercise "${practiceSection.replace(/\s+/g, " ").trim().slice(0, 80)}": an open collection has no checkable answer; put the exact material inside the exercise and require one checkable output per item.`;
    throw new ApplicationError(422, "VALIDATION_ERROR", message, { lesson_code_gate: true, repair_targets: [message] });
  }

  // 2.5 工作量核算：只折算分隔线之上的可见区阅读分钟 + 声明练习分钟。
  // 参考分析是做完题之后的订正材料，不属于首次阅读，计入会把短课系统性地判超载。
  // 容差下界固定 −30%；上界取「+30%」与「+5 分钟固定开销」中更大者，短课因此不再被十段骨架压死。
  // 发布态 design 只保留 design_check（估算分钟在核算结果里），回传再校验时从核算结果取回声明值。
  // 原始生成数据仍以 estimated_* 为准；两者同时存在时以原始字段为准，不采信留档覆盖。
  const declaredRead = integer(design.estimated_read_minutes ?? (design.design_check as Record<string, unknown> | undefined)?.declared_read_minutes, 1, 240);
  const practice = integer(design.estimated_practice_minutes ?? (design.design_check as Record<string, unknown> | undefined)?.estimated_practice_minutes, 0, 240);
  const read = readingMinutes(lessonVisibleRegion(content));
  const total = Math.round((read.minutes + practice) * 10) / 10;
  const deviation = Math.round((total / blueprint.minutes - 1) * 1000) / 1000;
  const upperMinutes = Math.max(blueprint.minutes * (1 + WORKLOAD_TOLERANCE), blueprint.minutes + SHORT_LESSON_SLACK_MINUTES);
  const lowerMinutes = blueprint.minutes * (1 - WORKLOAD_TOLERANCE);
  const toleranceUpper = Math.round((upperMinutes / blueprint.minutes - 1) * 1000) / 1000;
  if (total > upperMinutes || total < lowerMinutes - LOWER_SLACK_MINUTES) {
    // 工作量不足/超载是可修复的：真实语料（课程 B 第 4 节）15 分钟课只核算到 7.1 分钟，
    // 补写正文或调整练习就能落到区间内，不该因为一次估算失败丢掉整节课。
    const message = `Lesson workload ${total} minutes is outside ${(lowerMinutes - LOWER_SLACK_MINUTES).toFixed(1)}–${upperMinutes.toFixed(1)} minutes for the blueprint ${blueprint.minutes} minutes; compress the scope, not the title.`;
    throw new ApplicationError(422, "VALIDATION_ERROR", message, { lesson_code_gate: true, repair_targets: [message] });
  }

  // 2.6 正文实质：分钟数可以对得上，正文却是空壳时，工作量核算会被练习时长掩盖（20 分钟课 230 字也能算满分）。
  // 缺的是教学内容而不是分秒，所以给一次定向修复而不是直接判死。
  const substanceFloor = Math.max(SUBSTANCE_FLOOR_CJK, Math.round(blueprint.minutes * SUBSTANCE_CJK_PER_MINUTE));
  if (read.cjk < substanceFloor) {
    const message = `Lesson body has ${read.cjk} Chinese characters above the practice divider; a ${blueprint.minutes}-minute lesson needs at least ${substanceFloor} so the teaching is actually written, not just outlined.`;
    throw new ApplicationError(422, "VALIDATION_ERROR", message, { lesson_code_gate: true, repair_targets: [message] });
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