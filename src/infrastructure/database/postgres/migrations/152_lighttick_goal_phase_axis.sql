-- migration: 152  # 段号
-- owner: 教练线    # 占用者（goal coach / planning / review；人生阶段贯穿轴落在 goal 域）
-- depends: 029    # zook_lighttick_goals 建表
-- purpose: connect-stage-outcomes-to-clients 决策 1（承载 B）：goal 增加人生阶段归属
--          phase_id + phase_label。phase 在 goal 之上（跨 goal 分组），roadmap stage
--          在 goal 之内（阶段内成果），两层互补，不互相写入、不新建 phase 实体。
--          可空列：历史行保持 NULL，旧客户端忽略即降级为无阶段归属；回退不删除数据。
--          phase_label 是分组标签的展示缓存，权威键是 phase_id；重命名按 phase_id
--          批量更新同组全部 goal（design.md 决策 6），不做创建时快照。

ALTER TABLE zook_lighttick_goals ADD COLUMN IF NOT EXISTS phase_id TEXT;
ALTER TABLE zook_lighttick_goals ADD COLUMN IF NOT EXISTS phase_label TEXT;

-- 标签不能脱离分组键单独存在：无 phase_id 时必须无 phase_label。
-- 反之允许有 id 而暂无 label（读侧按空处理，不编造名称）。
DO $$ BEGIN
  ALTER TABLE zook_lighttick_goals ADD CONSTRAINT zook_lighttick_goal_phase_label_check
    CHECK (phase_id IS NOT NULL OR phase_label IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 支撑按 phase_id 批量重命名与同组读取；部分索引只覆盖已归属阶段的行。
CREATE INDEX IF NOT EXISTS lighttick_goal_phase_group_idx
  ON zook_lighttick_goals (app_id, user_id, phase_id)
  WHERE phase_id IS NOT NULL;