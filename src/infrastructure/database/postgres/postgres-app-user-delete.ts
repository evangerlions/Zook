type QueryFn = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

export async function deletePostgresAppUserRuntimeData(
  query: QueryFn,
  appId: string,
  userId: string,
): Promise<void> {
  await query("DELETE FROM zook_user_roles WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_notification_jobs WHERE app_id = $1 AND recipient_user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_analytics_events WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_content_safety_checks WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_ai_novel_daily_statistics WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_ai_novel_statistics_snapshots WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_files WHERE app_id = $1 AND owner_user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_feedback_attachments WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_feedback WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_client_log_lines WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_client_log_uploads WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_client_log_upload_tasks WHERE app_id = $1 AND user_id = $2", [appId, userId]);
}
