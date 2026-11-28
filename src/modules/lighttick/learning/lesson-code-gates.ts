import { ApplicationError } from "../../../shared/errors.ts";

/**
 * 课节代码门（verify-and-bind-lesson-feedback 4.6–4.9、5.1）。
 *
 * 这些检查不调模型、不增加成本，只在生成结果上跑确定性规则：
 * - B3 算式：只重算含显式等号且两侧均为纯数值表达式的句子；日期、区间、百分比、版本号一律跳过（标 unverified）。
 * - B4 单选：选项去重、正确项恰好一个、答案键必须落在选项集合内。
 * - B5 否定题干：练习题干出现"不正确/除外/NOT/EXCEPT"等否定式时拒绝。
 * - B6 答案泄漏：只比对参考分析中的判定句，要求连续 ≥12 字与可见区完全一致；概念段复述不算。
 * - C2 时长对账：正文里显式声明的"本课/合计 N 分钟"必须等于蓝图；分段分钟之和（声明两段以上时）同样必须相等。
 *
 * 误报比漏报更贵：规则一律「宁可不查，不可误杀」，无法判定的形态跳过并在结果里标 unverified。
 */

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
const SEPARATOR = /^ {0,3}---[ \t]*$/m;

export interface LessonCodeGateResult {
  /** 直接失败，不给修复机会（B3 不等、C2 对账不符）。 */
  fatal: string[];
  /** 可定向修复一次的问题（B4/B5/B6）。 */
  repairable: string[];
  /** 跳过而无法判定的检查项，留档用。 */
  unverified: string[];
}

export function lessonRegions(content: string): { visible: string; reference: string } {
  const match = SEPARATOR.exec(content);
  if (!match) return { visible: content, reference: "" };
  const at = match.index;
  return {
    visible: content.slice(0, at),
    reference: content.slice(at + match[0].length),
  };
}

/** 数值表达式：只允许数字、四则运算符、括号、小数点与空白。 */
const NUMERIC = /^[\d\s()+\-*/×÷.]+$/;

function numericValue(expr: string): number | null {
  const source = expr.replace(/×/g, "*").replace(/÷/g, "/").trim();
  if (!NUMERIC.test(source)) return null;
  if (!/\d/.test(source)) return null;
  // 只允许一层括号内的四则运算，避免把复杂排版当表达式。
  if ((source.match(/\(/g) ?? []).length !== (source.match(/\)/g) ?? []).length) return null;
  try {
    const tokens = source.match(/\d+(?:\.\d+)?|[+\-*/()]/g);
    if (!tokens) return null;
    const rebuilt = tokens.join("");
    if (rebuilt.replace(/[+\-*/()]/g, "").length !== source.replace(/[+\-*/()\s]/g, "").length) return null;
    return evaluate(tokens);
  } catch {
    return null;
  }
}

function evaluate(tokens: string[]): number {
  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];
  const factor = (): number => {
    const token = take();
    if (token === undefined) throw new Error("unexpected end");
    if (token === "-") return -factor();
    if (token === "+") return factor();
    if (token === "(") {
      const value = expression();
      if (take() !== ")") throw new Error("unbalanced");
      return value;
    }
    if (/^\d/.test(token)) return Number(token);
    throw new Error("unexpected token");
  };
  const term = (): number => {
    let value = factor();
    for (;;) {
      const token = peek();
      if (token === "*" || token === "/") {
        take();
        const right = factor();
        if (token === "/") {
          if (right === 0) throw new Error("divide by zero");
          value /= right;
        } else value *= right;
      } else return value;
    }
  };
  const expression = (): number => {
    let value = term();
    for (;;) {
      const token = peek();
      if (token === "+" || token === "-") {
        take();
        const right = term();
        value = token === "+" ? value + right : value - right;
      } else return value;
    }
  };
  const value = expression();
  if (index !== tokens.length) throw new Error("trailing tokens");
  if (!Number.isFinite(value)) throw new Error("not finite");
  return value;
}

/** 带百分号的数值按 /100 折算；「= 80%」与「= 0.8」因此等价。 */
function percentValue(raw: string): number | null {
  const hasPercent = /[%％]/.test(raw);
  const value = numericValue(raw.replace(/[%％]/g, " "));
  if (value === null) return null;
  return hasPercent ? value / 100 : value;
}

/** B3：逐句重算显式等式；只有两侧都能解析成纯数值才判断，否则跳过。 */
function arithmeticIssues(content: string, unverified: string[]): string[] {
  const issues: string[] = [];
  // 只抓「纯数值表达式 = 纯数值表达式」这一小段，前后中文说明不参与解析，避免整句判定把算式漏掉。
  // 百分号必须参与解析：真实语料「4/5 = 80%」曾因 % 不在字符类里被读成 0.8 vs 80 而误判致命。
  const equalities = content.matchAll(/([\d()+.\s+\-*/×÷%％]+)\s*(?:=|＝)\s*([\d()+.\s+\-*/×÷%％]+)/g);
  let evaluated = 0;
  for (const match of equalities) {
    const left = percentValue(match[1]!);
    const right = percentValue(match[2]!);
    if (left === null || right === null) continue;
    evaluated += 1;
    if (Math.abs(left - right) > 1e-9) {
      issues.push(`Lesson arithmetic "${match[0].trim()}" does not add up (${left} vs ${right}); correct the numbers or drop the equation.`);
    }
  }
  if (evaluated === 0) unverified.push("arithmetic:no_numeric_equality");
  return issues;
}

const OPTION_LINE = /^[ \t]*[(（]?([A-Da-d])[)）.．、][ \t]*(.+?)[ \t]*$/gm;
const ANSWER_KEY = /答案[：:][ \t]*([A-Da-d](?:[ \t、,，/]*[A-Da-d])*)/;

/** B4：单选题选项去重、正确项恰好一个。 */
function choiceIssues(content: string, reference: string, repairable: string[], unverified: string[]): void {
  const options = [...content.matchAll(OPTION_LINE)].map(match => ({
    label: match[1]!.toUpperCase(),
    body: match[2]!.replace(/[\s，。、（）()]/g, ""),
  }));
  if (options.length < 2) {
    unverified.push("choice:no_option_list");
    return;
  }
  const seen = new Map<string, string>();
  for (const option of options) {
    const previous = seen.get(option.body);
    if (previous) {
      repairable.push(`Lesson choice options ${previous} and ${option.label} are duplicates; regenerate distinct options.`);
    } else seen.set(option.body, option.label);
  }
  const answer = ANSWER_KEY.exec(reference)?.[1];
  if (!answer) {
    unverified.push("choice:no_answer_key");
    return;
  }
  const labels = [...answer.matchAll(/[A-Da-d]/g)].map(match => match[0].toUpperCase());
  if (labels.length !== 1) {
    repairable.push("Lesson choice answer key lists more than one correct option; keep exactly one.");
    return;
  }
  const optionSet = new Set(options.map(option => option.label));
  if (!optionSet.has(labels[0]!)) {
    repairable.push(`Lesson choice answer key points at ${labels[0]}, which is not among the listed options.`);
  }
}

const NEGATIVE_STEM = /(不正确|不属于|不包括|除外|错误的是|以下哪项不是|not\s+correct|which\s+is\s+not|EXCEPT|NOT\s+TRUE)/i;

function sectionBody(content: string, name: string): string {
  const start = content.search(new RegExp(`^ {0,3}#{1,6}[ \\t]+(?:[一二三四五六七八九十\\d]+[、.．)）][ \\t]*)?${name}`, "m"));
  if (start < 0) return "";
  const rest = content.slice(start + 1);
  const next = rest.search(/^ {0,3}#{1,6}[ \t]+/m);
  return next > 0 ? rest.slice(0, next) : rest;
}

/** B5：练习题干不得用否定式。只查练习段，避免概念段的「边界」等说明被误伤。 */
function negativeStemIssues(visible: string, repairable: string[], unverified: string[]): void {
  const exercise = sectionBody(visible, "练习");
  if (!exercise.trim()) {
    unverified.push("negative_stem:no_exercise_section");
    return;
  }
  const match = NEGATIVE_STEM.exec(exercise);
  if (match) {
    repairable.push(`Lesson exercise stem uses a negative form ("${match[1]}"); rewrite the stem positively.`);
  }
}

function normalizeForLeak(text: string): string {
  return text.replace(/[\s，。、；：！？""''（）()《》【】…—·.,;:!?]/g, "");
}

/**
 * B6：参考分析的判定句若在可见区连续出现 ≥20 字，判为答案泄漏。
 * 窗口经过两轮实测校准：12 → 16 → 20。中文里 12–16 字的重合是常态（原则句、判定标准、
 * 术语串都会命中），B 课第 6 节因「首句必须是明确的结论判断」（13 字）和
 * 「只有已核对的事项可以作为确定依据」（16 字）两例整节课被误杀；
 * 真正要拦的是把整句答案搬进正文，那类句子通常在 20 字以上。
 * 调宽窗口是拿「漏检极短答案」换「不误杀整节课」，方向与 4.6「宁可不查，不可误杀」一致。
 */
function leakageIssues(visible: string, reference: string, repairable: string[], unverified: string[]): void {
  if (!reference.trim()) {
    unverified.push("leakage:no_reference_section");
    return;
  }
  const visibleNormalized = normalizeForLeak(visible);
  const sentences = reference.split(/[。！？；\n]/).map(line => line.trim()).filter(Boolean);
  const WINDOW = 20;
  let comparable = 0;
  for (const sentence of sentences) {
    const normalized = normalizeForLeak(sentence);
    const cjk = (normalized.match(CJK) ?? []).length;
    if (cjk < WINDOW) continue;
    comparable += 1;
    for (let index = 0; index + WINDOW <= normalized.length; index += 1) {
      const window = normalized.slice(index, index + WINDOW);
      if ((window.match(CJK) ?? []).length < WINDOW) continue;
      if (visibleNormalized.includes(window)) {
        repairable.push(`Lesson reference analysis repeats a decisive sentence in the visible body ("${window}…"); rewrite the analysis so the answer stays below the separator.`);
        return;
      }
    }
  }
  if (comparable === 0) unverified.push("leakage:no_sentence_long_enough");
}

const DECLARED_TOTAL = /(?:本课|本节|合计|总计|共计|共)[^。\n]{0,8}?(\d+(?:\.\d+)?)\s*分钟/g;
const SECTION_MINUTES = /^ {0,3}#{1,6}[ \t]+[^\n]*?(回忆检查|引导问题|概念|示范|边界|练习|参考分析|自查|记忆提示|迁移任务)[^\n]*?(\d+(?:\.\d+)?)\s*分钟/gm;

/** C2：显式声明的总时长与分段分钟之和必须等于蓝图分钟。 */
function durationIssues(content: string, blueprintMinutes: number, unverified: string[]): string[] {
  const issues: string[] = [];
  let checked = 0;
  for (const match of content.matchAll(DECLARED_TOTAL)) {
    const minutes = Number(match[1]);
    checked += 1;
    if (Math.abs(minutes - blueprintMinutes) > 0.01) {
      issues.push(`Lesson declares ${minutes} minutes but the blueprint budget is ${blueprintMinutes} minutes; align the stated length.`);
    }
  }
  const sections = [...content.matchAll(SECTION_MINUTES)].map(match => ({
    name: match[1]!,
    minutes: Number(match[2]),
  }));
  if (sections.length >= 2) {
    const sum = sections.reduce((total, section) => total + section.minutes, 0);
    checked += 1;
    if (Math.abs(sum - blueprintMinutes) > 1) {
      issues.push(`Lesson section minutes add up to ${sum} but the blueprint budget is ${blueprintMinutes} minutes; reconcile the per-section timing.`);
    }
  }
  if (checked === 0) unverified.push("duration:no_declared_minutes");
  return issues;
}

export function lessonCodeGates(content: string, blueprintMinutes: number): LessonCodeGateResult {
  const { visible, reference } = lessonRegions(content);
  const fatal: string[] = [];
  const repairable: string[] = [];
  const unverified: string[] = [];
  fatal.push(...arithmeticIssues(content, unverified));
  choiceIssues(content, reference, repairable, unverified);
  negativeStemIssues(visible, repairable, unverified);
  // 找错/改错类练习天然要把待改原句放进正文（示范与练习都要引用），
  // 而参考分析必然引用同一句给判定，逐字比对必然误判泄漏（D 课第 4 节实测）。
  // 这类题不查泄漏，改为 unverified 留档，避免用「引用同一句」否定一份找错题。
  const practiceStart = visible.search(/\n\s*#+\s*练习/);
  const practiceText = practiceStart >= 0 ? visible.slice(practiceStart) : "";
  if (/(找出|检查|修改|订正|对照|纠错|改正|不符)/.test(practiceText)) {
    unverified.push("leakage:skipped_for_correction_task");
  } else {
    leakageIssues(visible, reference, repairable, unverified);
  }
  fatal.push(...durationIssues(content, blueprintMinutes, unverified));
  return { fatal, repairable, unverified };
}

/** 直接失败用 fatal；可修复问题带 repair_targets，由 runner 决定是否再生成一次。 */
export function assertLessonCodeGates(content: string, blueprintMinutes: number): void {
  const result = lessonCodeGates(content, blueprintMinutes);
  if (result.fatal.length) throw new ApplicationError(422, "VALIDATION_ERROR", result.fatal[0]!);
  if (result.repairable.length) {
    throw new ApplicationError(422, "VALIDATION_ERROR", result.repairable[0]!, {
      lesson_code_gate: true,
      repair_targets: result.repairable,
    });
  }
}
