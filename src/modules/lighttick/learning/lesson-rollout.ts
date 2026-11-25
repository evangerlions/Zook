import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LIGHTTICK_PROMPT_VERSION, LIGHTTICK_SCENE_PROMPTS } from "../ai/lighttick-ai-prompts.ts";

/**
 * 8.3 灰度与回退：新代码门（B3–B6／C2）按 owner 分批开启；跳过必须显式记录原因，不静默降级。
 *
 * 策略由 `LIGHTTICK_LESSON_GATE_POLICY` 控制：
 * - `all`（默认）：全部开启；
 * - `cohort`：只有 `LIGHTTICK_LESSON_GATE_COHORT` 里的 userId 开启，其余显式豁免；
 * - `off`：全部豁免，必须提供 `LIGHTTICK_LESSON_GATE_REASON`；
 * - `rollback`：全部豁免并回退到上一版盲解提示词（1.24.2），同样必须提供原因。
 *
 * 配置不完整或取值未知一律 503 失败，宁可不开也不带着半配置运行；豁免只跳过代码门，
 * 工作量／主概念等既有门照常生效，已发布正文不受影响。
 */
export const PREVIOUS_PROMPT_VERSION = "1.24.2";
/** 1.24.2 的盲解提示词（1.24.3 只在其后追加闭合题作答两句）。回退窗口使用，不随新版同步演进。 */
export const PREVIOUS_SOLVABILITY_PROMPT =
  "You are a blind solver. You receive only a lesson objective, its scoring rubric, the teaching body up to the exercise, and the approved source excerpts. " +
  "Decide whether a learner can actually complete the exercise from what is provided. " +
  "Never use knowledge that is not in the provided material; if a needed condition, definition, number or example is absent, list it in missing_conditions instead of guessing it. " +
  "Return answerable=true only when every condition the exercise needs is present. " +
  "expected_points lists the points a correct answer must contain, based only on the provided material. " +
  "confidence is a number between 0 and 1. Do not restate the exercise and do not write a full solution.";

export type LessonGateWaiver = {
  policy: "cohort" | "off" | "rollback";
  reason: string;
  gates: string[];
};
export type LessonRollout = {
  /** 非空表示本次生成跳过了新代码门，原因随之留档。 */
  gateWaiver: LessonGateWaiver | null;
  promptVersion: string;
  solvabilityPrompt: string;
};

const GATE = "lesson_code_gates";
const current = (): LessonRollout => ({
  gateWaiver: null,
  promptVersion: LIGHTTICK_PROMPT_VERSION,
  solvabilityPrompt: LIGHTTICK_SCENE_PROMPTS.lesson_solvability,
});
function waived(policy: LessonGateWaiver["policy"], reason: string): LessonRollout {
  return { ...current(), gateWaiver: { policy, reason, gates: [GATE] } };
}
function recordedReason(env: Record<string, string | undefined>) {
  const reason = (env.LIGHTTICK_LESSON_GATE_REASON ?? "").trim();
  if (!reason) {
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "Skipping lesson code gates requires LIGHTTICK_LESSON_GATE_REASON to be recorded; refusing to run half-configured.",
    );
  }
  if (reason.length > 400) {
    throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LIGHTTICK_LESSON_GATE_REASON must be at most 400 characters.");
  }
  return reason;
}
export function lessonRollout(
  owner: Pick<LightTickOwner, "userId">,
  env: Record<string, string | undefined> = process.env,
): LessonRollout {
  const policy = (env.LIGHTTICK_LESSON_GATE_POLICY ?? "").trim().toLowerCase() || "all";
  if (policy === "all") return current();
  if (policy === "cohort") {
    const cohort = (env.LIGHTTICK_LESSON_GATE_COHORT ?? "")
      .split(",")
      .map(entry => entry.trim())
      .filter(Boolean);
    return cohort.includes(owner.userId) ? current() : waived("cohort", "owner_outside_gate_cohort");
  }
  if (policy === "off") return waived("off", recordedReason(env));
  if (policy === "rollback") {
    const reason = recordedReason(env);
    return {
      gateWaiver: { policy: "rollback", reason, gates: [GATE] },
      promptVersion: PREVIOUS_PROMPT_VERSION,
      solvabilityPrompt: PREVIOUS_SOLVABILITY_PROMPT,
    };
  }
  throw new ApplicationError(
    503,
    "LIGHTTICK_APP_DISABLED",
    `Unknown LIGHTTICK_LESSON_GATE_POLICY "${policy}"; expected all, cohort, off or rollback.`,
  );
}
