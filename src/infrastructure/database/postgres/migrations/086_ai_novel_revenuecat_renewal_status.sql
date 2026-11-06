ALTER TABLE zook_ai_novel_billing_memberships
  ADD COLUMN IF NOT EXISTS revenuecat_renewal_status text;
