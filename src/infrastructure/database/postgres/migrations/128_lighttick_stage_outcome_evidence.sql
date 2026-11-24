ALTER TABLE zook_lighttick_outcome_evidence
  ALTER COLUMN milestone_id DROP NOT NULL,
  ADD COLUMN roadmap_stage_id text,
  ADD COLUMN occurred_on date,
  ADD COLUMN metric text,
  ADD COLUMN task_id text,
  ADD COLUMN task_title text,
  ADD CONSTRAINT lighttick_outcome_evidence_target_check
    CHECK ((milestone_id IS NULL) <> (roadmap_stage_id IS NULL)),
  ADD CONSTRAINT lighttick_stage_outcome_fields_check
    CHECK (roadmap_stage_id IS NULL OR
      (occurred_on IS NOT NULL AND metric IS NOT NULL AND (task_id IS NULL) = (task_title IS NULL)));

CREATE INDEX lighttick_outcome_stage_window_idx ON zook_lighttick_outcome_evidence
  (app_id, user_id, goal_id, occurred_on DESC, roadmap_stage_id) WHERE roadmap_stage_id IS NOT NULL;

CREATE UNIQUE INDEX lighttick_outcome_stage_correction_idx ON zook_lighttick_outcome_evidence
  (app_id, user_id, goal_id, roadmap_stage_id, corrected_from)
  WHERE roadmap_stage_id IS NOT NULL AND corrected_from IS NOT NULL;
