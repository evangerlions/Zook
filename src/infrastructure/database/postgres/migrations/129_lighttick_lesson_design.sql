-- migration: 129  # 段号
-- owner: 教练线    # 占用者（learning 课节质量与练习反馈）
-- depends: 085    # zook_lighttick_lesson_publications 建表
-- purpose: verify-and-bind-lesson-feedback 2.1（发布态 design 冻结）。
--          课节发布时把 design（主概念、目标、使用概念、评分维度、复习覆盖、
--          工作量核算）按 content_version 冻结入库；正文改版产生新 content_version，
--          因此 design 天然随版本分叉，旧版本 attempt 继续指向旧评分维度。
--          不写回 publications：正文与设计各自一表，读路径按版本 join，
--          回退只需删表（当前无任何代码读取即无影响）。

CREATE TABLE IF NOT EXISTS zook_lighttick_lesson_design (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  content_version TEXT NOT NULL CHECK(content_version ~ '^[a-f0-9]{64}$'),
  design JSONB NOT NULL CHECK(jsonb_typeof(design)='object'),
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY(app_id,user_id,lesson_id,content_version),
  FOREIGN KEY(app_id,user_id,lesson_id,content_version)
    REFERENCES zook_lighttick_lesson_publications(app_id,user_id,lesson_id,content_version)
);

-- 按课节读当前版本设计（反馈 read/submit 共用同一解析），历史版本按主键直取。
CREATE INDEX IF NOT EXISTS zook_lighttick_lesson_design_by_lesson
  ON zook_lighttick_lesson_design (app_id,user_id,lesson_id);
