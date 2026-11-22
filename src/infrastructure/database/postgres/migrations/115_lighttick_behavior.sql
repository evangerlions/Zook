CREATE INDEX IF NOT EXISTS zook_lighttick_report_topic_idx ON zook_lighttick_account_reports(app_id,user_id,(COALESCE(data->>'topic','account')),created_at DESC,id) WHERE status<>'deleted';
