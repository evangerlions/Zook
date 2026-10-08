-- LightTick E1 evidence/learning foundation (evolve 2.2). Additive owner-scoped
-- tables for progressive understanding and outcome feedback. Four entities:
--   GoalContext    — goal-level persistent understanding (success criteria, level,
--                    deadline, weekly time), replacing free-text constraints.
--   Milestone      — observable outcome node (not a task count).
--   OutcomeEvidence— text/number/status outcome with correction lineage.
--   TaskFamily     — cross-task comparable learning group (lineage stays separate).
--
-- All tables carry app_id + user_id (owner isolation), an integer version for CAS,
-- and delete coverage via owner-scoped indexes. No DELETE breaks existing Today
-- / execution / recovery reads: old clients ignore these tables entirely.
--
-- Deadline note: goal deadline is stored inside the `deadline` JSONB value
-- (source-tagged). A dedicated sortable DATE column is intentionally omitted here
-- and can be added later (additive) if DB-level deadline ordering is required.

-- GoalContext: 1:1 with a goal (goal_id mirrors zook_lighttick_goals.id).
CREATE TABLE IF NOT EXISTS zook_lighttick_goal_contexts (
  goal_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  domain TEXT,
  desired_outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_level JSONB NOT NULL DEFAULT '{}'::jsonb,
  deadline JSONB NOT NULL DEFAULT '{}'::jsonb,
  weekly_available_minutes JSONB NOT NULL DEFAULT '{}'::jsonb,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(desired_outcome)='object'),
  CHECK (jsonb_typeof(current_level)='object'),
  CHECK (jsonb_typeof(deadline)='object'),
  CHECK (jsonb_typeof(weekly_available_minutes)='object'),
  CHECK (jsonb_typeof(constraints)='object')
);
CREATE INDEX IF NOT EXISTS zook_lighttick_goal_contexts_owner_idx
  ON zook_lighttick_goal_contexts (app_id, user_id, updated_at DESC);

-- Milestone: observable achievement node. Uses sort_order (SQL reserved `order`).
CREATE TABLE IF NOT EXISTS zook_lighttick_milestones (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, goal_id TEXT NOT NULL,
  title TEXT NOT NULL,
  observable_criteria TEXT NOT NULL,
  subject_id TEXT,
  sort_order INTEGER,
  depends_on JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'proposed',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(depends_on)='array')
);
DO $$ BEGIN
  ALTER TABLE zook_lighttick_milestones ADD CONSTRAINT zook_lighttick_milestone_status_check
    CHECK (status IN ('proposed', 'active', 'achieved', 'superseded'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS zook_lighttick_milestones_owner_goal_idx
  ON zook_lighttick_milestones (app_id, user_id, goal_id, sort_order);

-- OutcomeEvidence: outcome feedback with source/confirmation and correction chain.
-- `value` holds the kind-discriminated shape: {value} for text; {value,unit,
-- comparable_condition} for number; {value} for status. Only confirmed evidence
-- participates in achievement decisions; corrections point at the prior (read-only)
-- row via corrected_from and never delete history.
CREATE TABLE IF NOT EXISTS zook_lighttick_outcome_evidence (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, goal_id TEXT NOT NULL, milestone_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  source TEXT NOT NULL,
  confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  corrected_from TEXT,
  occurred_at TIMESTAMPTZ NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (jsonb_typeof(value)='object')
);
DO $$ BEGIN
  ALTER TABLE zook_lighttick_outcome_evidence ADD CONSTRAINT zook_lighttick_outcome_kind_check
    CHECK (kind IN ('text', 'number', 'status'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE zook_lighttick_outcome_evidence ADD CONSTRAINT zook_lighttick_outcome_source_check
    CHECK (source IN ('user', 'confirmed', 'imported', 'assumption'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS zook_lighttick_outcome_owner_milestone_idx
  ON zook_lighttick_outcome_evidence (app_id, user_id, milestone_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS zook_lighttick_outcome_owner_goal_idx
  ON zook_lighttick_outcome_evidence (app_id, user_id, goal_id, occurred_at DESC);

-- TaskFamily: cross-task comparable learning group. Historical rows without a
-- family remain `source='unknown'` and are never guessed into a family.
CREATE TABLE IF NOT EXISTS zook_lighttick_task_families (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  family_key TEXT NOT NULL,
  goal_or_domain TEXT,
  selected_variant TEXT NOT NULL DEFAULT 'standard',
  context_version TEXT NOT NULL DEFAULT '1',
  source TEXT NOT NULL DEFAULT 'unknown',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DO $$ BEGIN
  ALTER TABLE zook_lighttick_task_families ADD CONSTRAINT zook_lighttick_family_variant_check
    CHECK (selected_variant IN ('standard', 'light', 'minimum'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$ BEGIN
  ALTER TABLE zook_lighttick_task_families ADD CONSTRAINT zook_lighttick_family_source_check
    CHECK (source IN ('assigned', 'proposed', 'imported', 'unknown'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_task_families_owner_key_variant_uidx
  ON zook_lighttick_task_families (app_id, user_id, family_key, selected_variant, context_version);