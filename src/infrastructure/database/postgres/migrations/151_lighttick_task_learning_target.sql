-- migration: 151  # 段号
-- owner: 教练线    # 占用者（goal coach / planning / review；M8 学习排期落在 task 执行域）
-- depends: 029, 065  # zook_lighttick_tasks 建表；scheduled_business_date 业务日列
-- purpose: M8 connect-learning-plans-to-today：task 增加固定课程来源 learning_target
--          （kind/plan_id/lesson_no 对齐行动域 normalized_target 锚点，附路线发布版、
--          正文 ID/版本与 learn/review/apply 用途）。可空列：历史行保持 NULL，旧客户端
--          忽略即降级为普通任务；回退保留来源与既有事实，不删除数据。
ALTER TABLE zook_lighttick_tasks ADD COLUMN IF NOT EXISTS learning_target JSONB;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_task_learning_target_check
    CHECK (learning_target IS NULL OR (
      jsonb_typeof(learning_target) = 'object'
      AND learning_target->>'kind' = 'plan'
      AND learning_target->>'purpose' IN ('learn', 'review', 'apply')
      AND jsonb_typeof(learning_target->'lesson_no') = 'number'
      AND jsonb_typeof(learning_target->'route_version') = 'number'
      AND jsonb_typeof(learning_target->'plan_id') = 'string'
      AND jsonb_typeof(learning_target->'lesson_id') = 'string'
      AND learning_target->>'content_version' ~ '^[a-f0-9]{64}$'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 当天 learn 任务按课次来源对账（S0 5.2 改投影）的部分索引：只索引带来源的未终态行。
CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_learning_target_idx
  ON zook_lighttick_tasks (app_id, user_id, (learning_target->>'plan_id'), (learning_target->>'lesson_no'))
  WHERE learning_target IS NOT NULL;