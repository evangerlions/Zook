/** Fixed, reviewable design: two-sided alpha .05, 80% power, independent proportions.
 * Normal approximation (pooled null / unpooled alternative); planning only.
 * https://www.statsmodels.org/stable/generated/statsmodels.stats.proportion.samplesize_proportions_2indep_onetail.html
 */
export function requiredMatureUsers(baseline: number, delta: number): number {
  const alternative = baseline + delta, pooled = (baseline + alternative) / 2;
  return Math.ceil((1.959963984540054 * Math.sqrt(2 * pooled * (1 - pooled))
    + 0.8416212335729143 * Math.sqrt(baseline * (1 - baseline) + alternative * (1 - alternative))) ** 2 / delta ** 2);
}

export interface RetentionExperimentDesign {
  owner: string; primaryMetric: "d7_local_goal_retention";
  baselineRate: number; minimumDetectableEffect: number; targetMaturePerVariant: number;
  minimumEnrollmentDays: number; followupDays: number; lateArrivalDays: number;
  stopPolicy: "fixed_horizon_no_peeking";
  guardrails: { maxAuthFailureRate: number; maxDuplicateOperations: number; maxLocalActionP95Millis: number };
}
export interface RetentionExperimentConfig { id: string; enabled: boolean; treatmentPercent: number; design?: RetentionExperimentDesign }
export function inspectRetentionExperiment(raw: string | undefined) {
  const errors: string[] = [];
  let config: RetentionExperimentConfig | undefined;
  let requiredPerVariant: number | null = null;
  try { config = JSON.parse(raw ?? "null") ?? undefined; } catch { errors.push("配置不是合法JSON"); }
  if (!config) return { config: undefined, valid: false, errors: errors.length ? errors : ["尚未配置实验"], requiredPerVariant };
  if (typeof config.id !== "string" || !/^[a-z0-9_-]{1,64}$/.test(String(config.id ?? "")) || typeof config.enabled !== "boolean"
    || !Number.isInteger(config.treatmentPercent) || config.treatmentPercent < 0 || config.treatmentPercent > 50) errors.push("实验ID、启用值或分组比例无效");
  const design = config.design;
  if (!design) errors.push("缺少预注册实验设计");
  else {
    if (typeof design.owner !== "string" || !design.owner.trim() || design.owner.length > 64) errors.push("缺少真实分析负责人");
    if (design.primaryMetric !== "d7_local_goal_retention" || design.stopPolicy !== "fixed_horizon_no_peeking") errors.push("主指标或停止规则无效");
    if (!Number.isFinite(design.baselineRate) || design.baselineRate <= 0 || design.baselineRate >= 1 ||
      !Number.isFinite(design.minimumDetectableEffect) || design.minimumDetectableEffect <= 0 || design.baselineRate + design.minimumDetectableEffect >= 1) errors.push("基线与最小可检测差异无效");
    else requiredPerVariant = requiredMatureUsers(design.baselineRate, design.minimumDetectableEffect);
    if (!Number.isSafeInteger(design.targetMaturePerVariant) || !requiredPerVariant || design.targetMaturePerVariant < requiredPerVariant) errors.push("每组成熟样本目标低于规划样本量");
    if (!Number.isInteger(design.minimumEnrollmentDays) || design.minimumEnrollmentDays < 14 ||
      !Number.isInteger(design.followupDays) || design.followupDays < 8 || !Number.isInteger(design.lateArrivalDays) || design.lateArrivalDays < 7) errors.push("需至少14日入组、8日随访和7日迟到数据窗口");
    const guardrails = design.guardrails;
    if (!guardrails || !Number.isFinite(guardrails.maxAuthFailureRate) || guardrails.maxAuthFailureRate <= 0 || guardrails.maxAuthFailureRate >= 1 ||
      guardrails.maxDuplicateOperations !== 0 || !Number.isFinite(guardrails.maxLocalActionP95Millis) || guardrails.maxLocalActionP95Millis <= 0) errors.push("账号失败率、零重复动作和本地操作耗时护栏不完整");
  }
  if (config.enabled && config.treatmentPercent === 0) errors.push("开启对照实验需要正的实验组比例");
  return { config, valid: errors.length === 0, errors, requiredPerVariant };
}
