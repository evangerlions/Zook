import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner } from "../lighttick.types.ts";

/**
 * C3 4.2 读切换回退开关。
 * false（默认）＝读 goal.constraints 列（列 A 权威，兼容旧行为）；
 * true＝读 zook_lighttick_goal_contexts 表（表 B 权威）。
 * 迁移完成后删除本开关与 resolveGoalConditions。
 */
export const READ_GOAL_CONTEXT_FROM_TABLE = false;

/**
 * 把表 B 的 confirmed_planning_conditions 注入 goal.constraints，
 * 使下游纯函数（conditionHistory / effectiveDailyLimits / assertDailyCapacity 等）
 * 无需改动即可读到表 B 权威数据。表 B 无记录或开关关闭时原样返回 goal。
 */
export async function resolveGoalConditions(
  repository: LightTickRepository,
  owner: LightTickOwner,
  goal: LightTickGoalRow,
): Promise<LightTickGoalRow> {
  if (!READ_GOAL_CONTEXT_FROM_TABLE) return goal;
  const ctx = await repository.getGoalContext(owner, goal.id);
  const conditions = ctx?.constraints?.confirmed_planning_conditions;
  if (conditions === undefined) return goal;
  return { ...goal, constraints: { ...goal.constraints, confirmed_planning_conditions: conditions } };
}
