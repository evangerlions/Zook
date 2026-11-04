ALTER TABLE zook_ai_novel_billing_memberships
  ADD COLUMN IF NOT EXISTS credit_window_anchor_at TIMESTAMPTZ;
