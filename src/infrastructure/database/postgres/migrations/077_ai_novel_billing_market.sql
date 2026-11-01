ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN IF NOT EXISTS market text
  CHECK (market IS NULL OR market IN ('app_store','google_play','xiaomi','vivo','oppo','huawei','honor','direct'));
-- Verified store identity or explicit direct distribution are unambiguous.
-- A generic China Android store or Alipay source cannot identify Xiaomi/vivo.
UPDATE zook_ai_novel_billing_transactions SET market=CASE
  WHEN source='app_store' THEN 'app_store'
  WHEN source='play_store' THEN 'google_play'
  WHEN distribution IN ('direct_android','web','windows') THEN 'direct'
  ELSE NULL END
WHERE market IS NULL AND (source IN ('app_store','play_store') OR distribution IN ('direct_android','web','windows'));
