-- Migration: 034_bodylog_rewards
-- Description: Create table for rewards earned from completing plans and missions
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  reward_type VARCHAR(50) NOT NULL,
  reward_value JSONB NOT NULL DEFAULT '{}',
  claimed BOOLEAN NOT NULL DEFAULT false,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_rewards_plan
    FOREIGN KEY (plan_id)
    REFERENCES bodylog_seven_day_plans(id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_bodylog_rewards_plan_id ON bodylog_rewards(plan_id);
CREATE INDEX IF NOT EXISTS idx_bodylog_rewards_claimed ON bodylog_rewards(claimed);
CREATE INDEX IF NOT EXISTS idx_bodylog_rewards_created_at ON bodylog_rewards(created_at);

COMMENT ON TABLE bodylog_rewards IS 'Rewards earned from 7-day plans';
COMMENT ON COLUMN bodylog_rewards.claimed IS 'Whether the reward has been claimed by the user';
