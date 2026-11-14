-- 108_lighttick_reading.sql
-- 阅读域：文章本体、中文导读、阅读状态（位置/读完）、私人反馈、每日选文。
-- 纯增量：回滚应用不清数据，文章与反馈是用户资产。
-- 口径见 plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/reading-domain-design.md

-- 1. 文章本体。判重用 url_hash（规范化后的 sha256），原 url 保留展示。
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_articles (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK(id ~ '^[a-zA-Z0-9_-]{8,128}$'),
  url TEXT NOT NULL CHECK(char_length(url) BETWEEN 1 AND 1500),
  url_hash TEXT NOT NULL CHECK(url_hash ~ '^[0-9a-f]{64}$'),
  title TEXT NOT NULL CHECK(char_length(title) BETWEEN 1 AND 300),
  source TEXT NOT NULL DEFAULT '' CHECK(char_length(source)<=200),
  language TEXT NOT NULL DEFAULT 'zh' CHECK(language IN ('zh','en')),
  topic TEXT NOT NULL DEFAULT '' CHECK(char_length(topic)<=60),
  summary TEXT NOT NULL DEFAULT '' CHECK(char_length(summary)<=4000),
  body TEXT NOT NULL DEFAULT '' CHECK(char_length(body)<=200000),
  -- body_kind 必须显式：界面要能区分「有全文」与「只有摘要」，导读依据不能靠猜。
  body_kind TEXT NOT NULL DEFAULT 'none' CHECK(body_kind IN ('full','excerpt','none')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,user_id,id),
  UNIQUE(app_id,user_id,url_hash)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_reading_articles_owner_idx
  ON zook_lighttick_reading_articles(app_id,user_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS zook_lighttick_reading_articles_topic_idx
  ON zook_lighttick_reading_articles(app_id,user_id,topic);

-- 2. 中文导读：与文章 1:1，独立 revision（重新生成导读不得让文章版本变化）。
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_guides (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis IN ('full_text','summary')),
  core_points JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(core_points)='array'),
  evidence_limits JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(evidence_limits)='array'),
  language_notes JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(language_notes)='array'),
  application_questions JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(application_questions)='array'),
  model TEXT NOT NULL DEFAULT '' CHECK(char_length(model)<=120),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,user_id,article_id),
  FOREIGN KEY(app_id,user_id,article_id)
    REFERENCES zook_lighttick_reading_articles(app_id,user_id,id) ON DELETE CASCADE
);

-- 3. 阅读状态：位置与显式读完。与反馈分表，避免两种保存互相判冲突。
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_states (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  position_ratio INTEGER NOT NULL DEFAULT 0 CHECK(position_ratio BETWEEN 0 AND 100),
  position_anchor TEXT NOT NULL DEFAULT '' CHECK(char_length(position_anchor)<=200),
  -- 读完是显式动作；不从 position_ratio=100 推断，滚到底不等于读懂。
  completed_at TIMESTAMPTZ,
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,user_id,article_id),
  FOREIGN KEY(app_id,user_id,article_id)
    REFERENCES zook_lighttick_reading_articles(app_id,user_id,id) ON DELETE CASCADE
);

-- 4. 私人反馈。评分允许 NULL：「没判断」与「判断为 3 分」是两件事。
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_feedback (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  article_id TEXT NOT NULL,
  value_rating INTEGER CHECK(value_rating BETWEEN 1 AND 5),
  difficulty INTEGER CHECK(difficulty BETWEEN 1 AND 5),
  takeaway TEXT NOT NULL DEFAULT '' CHECK(char_length(takeaway)<=4000),
  question TEXT NOT NULL DEFAULT '' CHECK(char_length(question)<=2000),
  application TEXT NOT NULL DEFAULT '' CHECK(char_length(application)<=2000),
  tags JSONB NOT NULL DEFAULT '[]'::jsonb CHECK(jsonb_typeof(tags)='array' AND jsonb_array_length(tags)<=12),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,user_id,article_id),
  FOREIGN KEY(app_id,user_id,article_id)
    REFERENCES zook_lighttick_reading_articles(app_id,user_id,id) ON DELETE CASCADE
);

-- 5. 每日选文：固定编号 1..3。落库而不是现算，因为库会在一天内变化。
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_daily (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  business_date DATE NOT NULL,
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 3),
  article_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '' CHECK(char_length(reason)<=200),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,user_id,business_date,ordinal),
  UNIQUE(app_id,user_id,business_date,article_id),
  FOREIGN KEY(app_id,user_id,article_id)
    REFERENCES zook_lighttick_reading_articles(app_id,user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS zook_lighttick_reading_daily_article_idx
  ON zook_lighttick_reading_daily(app_id,user_id,article_id,business_date DESC);
