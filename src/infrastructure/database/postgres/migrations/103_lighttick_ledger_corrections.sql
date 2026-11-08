-- Additive immutable correction facts. No existing rows or financial amounts are rewritten.
ALTER TABLE zook_lighttick_investment_events ADD COLUMN IF NOT EXISTS corrects_id TEXT;
ALTER TABLE zook_lighttick_investment_events ADD COLUMN IF NOT EXISTS correction JSONB;
ALTER TABLE zook_lighttick_investment_events DROP CONSTRAINT IF EXISTS zook_lighttick_investment_events_kind_check;
ALTER TABLE zook_lighttick_investment_events DROP CONSTRAINT IF EXISTS zook_lighttick_investment_events_check;
DO $migration$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zook_lighttick_investment_events'::regclass AND conname='lighttick_ledger_kind') THEN
  ALTER TABLE zook_lighttick_investment_events ADD CONSTRAINT lighttick_ledger_kind CHECK(kind IN ('fill','cash','correction'));
 END IF;
END $migration$;
DO $migration$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zook_lighttick_investment_events'::regclass AND conname='lighttick_ledger_account_event_unique') THEN
  ALTER TABLE zook_lighttick_investment_events ADD CONSTRAINT lighttick_ledger_account_event_unique UNIQUE(app_id,user_id,account_id,id);
 END IF;
END $migration$;
DO $migration$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zook_lighttick_investment_events'::regclass AND conname='lighttick_ledger_correction_target') THEN
  ALTER TABLE zook_lighttick_investment_events ADD CONSTRAINT lighttick_ledger_correction_target FOREIGN KEY(app_id,user_id,account_id,corrects_id) REFERENCES zook_lighttick_investment_events(app_id,user_id,account_id,id);
 END IF;
END $migration$;
CREATE UNIQUE INDEX IF NOT EXISTS lighttick_ledger_target_once ON zook_lighttick_investment_events(app_id,user_id,account_id,corrects_id) WHERE corrects_id IS NOT NULL;
DO $migration$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='zook_lighttick_investment_events'::regclass AND conname='lighttick_ledger_fact_shape') THEN
  ALTER TABLE zook_lighttick_investment_events ADD CONSTRAINT lighttick_ledger_fact_shape CHECK(COALESCE(
  ((kind IN ('fill','cash') AND corrects_id IS NULL AND correction IS NULL) OR
   (kind='correction' AND corrects_id IS NOT NULL AND corrects_id<>id AND jsonb_typeof(correction)='object' AND
    correction->>'target_input_digest' ~ '^[a-f0-9]{64}$' AND length(correction->>'reason') BETWEEN 1 AND 4000 AND
    (correction->'replacement'='null'::jsonb OR (jsonb_typeof(correction->'replacement')='object' AND correction->'replacement'->>'business_date' ~ '^\d{4}-\d{2}-\d{2}$'))))
  AND
  (((kind='fill' OR (kind='correction' AND correction->'replacement'->>'kind'='fill')) AND
     instrument_id IS NOT NULL AND side IS NOT NULL AND price IS NOT NULL AND quantity IS NOT NULL AND cash_kind IS NULL AND amount IS NULL AND source IN ('manual','csv','broker','fund_confirmation')) OR
   ((kind='cash' OR (kind='correction' AND correction->'replacement'->>'kind'='cash')) AND
     cash_kind IN ('deposit','withdrawal','dividend','interest','fee','fund_receivable_hold','fund_receivable_release') AND amount IS NOT NULL AND instrument_id IS NULL AND side IS NULL AND price IS NULL AND quantity IS NULL AND fee IS NULL AND tax IS NULL AND settlement_amount IS NULL AND source IS NULL) OR
   (kind='correction' AND correction->'replacement'='null'::jsonb AND instrument_id IS NULL AND side IS NULL AND cash_kind IS NULL AND price IS NULL AND quantity IS NULL AND fee IS NULL AND tax IS NULL AND settlement_amount IS NULL AND amount IS NULL AND source IS NULL)),FALSE));
 END IF;
END $migration$;
