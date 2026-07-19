type QueryFn = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

export async function deletePostgresApp(query: QueryFn, appId: string): Promise<void> {
  const roleRows = await query("SELECT id FROM zook_roles WHERE app_id = $1", [appId]);
  const roleIds = roleRows.rows.map((row) => String((row as { id: unknown }).id));
  if (roleIds.length > 0) {
    await query("DELETE FROM zook_role_permissions WHERE role_id = ANY($1::text[])", [roleIds]);
  }

  const tables = [
    "zook_user_roles",
    "zook_app_users",
    "zook_roles",
    "zook_audit_logs",
    "zook_notification_jobs",
    "zook_failed_events",
    "zook_analytics_events",
    "zook_content_safety_checks",
    "zook_ai_novel_daily_statistics",
    "zook_ai_novel_statistics_snapshots",
    "zook_feedback_attachments",
    "zook_feedback",
    "zook_files",
    "zook_client_log_lines",
    "zook_client_log_uploads",
    "zook_client_log_upload_tasks",
    "zook_app_configs",
  ];
  for (const table of tables) {
    await query(`DELETE FROM ${table} WHERE app_id = $1`, [appId]);
  }
  await query("DELETE FROM zook_apps WHERE id = $1", [appId]);
}
