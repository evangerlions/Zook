-- migration: 150
-- owner: 教练线
-- depends: 061 (zook_lighttick_goal_contexts)
-- purpose: 回填历史 goal.confirmed_planning_conditions 到 zook_lighttick_goal_contexts.constraints，保证 C3 双写后两处一致

-- C3 4.1 双写落地：读仍走 goal.constraints 列，表 B 仅作镜像。
-- 已应用迁移不重编号；本回填只复制有 confirmed_planning_conditions 的目标，
-- 未确认条件的目标保持表 B 无记录（读侧按空处理）。
INSERT INTO zook_lighttick_goal_contexts
  (goal_id, app_id, user_id, constraints, version, created_at, updated_at)
SELECT
  id, app_id, user_id, constraints, 1, NOW(), NOW()
FROM zook_lighttick_goals
WHERE constraints ? 'confirmed_planning_conditions'
ON CONFLICT (goal_id) DO UPDATE
  SET constraints = EXCLUDED.constraints,
      updated_at = NOW();
