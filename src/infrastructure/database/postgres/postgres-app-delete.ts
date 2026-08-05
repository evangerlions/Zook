type QueryFn = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

export async function deletePostgresApp(query: QueryFn, appId: string): Promise<void> {
  const roleRows = await query("SELECT id FROM zook_roles WHERE app_id = $1", [appId]);
  const roleIds = roleRows.rows.map((row) => String((row as { id: unknown }).id));
  if (roleIds.length > 0) {
    await query("DELETE FROM zook_role_permissions WHERE role_id = ANY($1::text[])", [roleIds]);
  }

  const tables = [
    "zook_bodylog_challenge_members",
    "zook_bodylog_challenges",
    "zook_bodylog_invitation_attributions",
    "zook_bodylog_invitations",
    "zook_bodylog_leaderboard_entries",
    "zook_bodylog_daily_aggregates",
    "zook_bodylog_weekly_goal_snapshots",
    "zook_bodylog_reports",
    "zook_bodylog_blocks",
    "zook_bodylog_friendships",
    "zook_bodylog_friend_requests",
    "zook_bodylog_profiles",
    "zook_user_roles",
    "zook_app_users",
    "zook_roles",
    "zook_audit_logs",
    "zook_notification_jobs",
    "zook_failed_events",
    "zook_analytics_events",
    "zook_content_safety_checks",
    "zook_feedback_attachments",
    "zook_feedback",
    "zook_ai_output_reports",
    "zook_ai_output_reactions",
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
