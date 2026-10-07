-- LightTick review cadence (review-cadence 1.1). Additive goal-level preference.
-- Absent/NULL means "fall back to default (weekly only)". The JSON shape is
-- { "layers": ["day"|"week"|"month", ...] }; an empty array means reviews off.
ALTER TABLE zook_lighttick_goals
  ADD COLUMN IF NOT EXISTS review_cadence JSONB;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_goals ADD CONSTRAINT zook_lighttick_goal_review_cadence_check
    CHECK (review_cadence IS NULL OR jsonb_typeof(review_cadence)='object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;