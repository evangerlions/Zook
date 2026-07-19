type QueryFn = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

const FROGSLEEP_USER_RUNTIME_TABLES = [
  "zook_frogsleep_sleep_invites",
  "zook_frogsleep_sleep_relationships",
  "zook_frogsleep_guardianship_preferences",
  "zook_frogsleep_sleep_sessions",
  "zook_frogsleep_sleep_events",
  "zook_frogsleep_sleep_summaries",
  "zook_frogsleep_night_recaps",
  "zook_frogsleep_focus_profiles",
  "zook_frogsleep_focus_relationships",
  "zook_frogsleep_focus_invites",
  "zook_frogsleep_focus_sessions",
  "zook_frogsleep_focus_shared_moments",
  "zook_frogsleep_focus_messages",
  "zook_frogsleep_focus_milestones",
  "zook_frogsleep_focus_match_feedback",
  "zook_frogsleep_buddy_shares",
  "zook_frogsleep_buddy_interactions",
  "zook_frogsleep_buddy_joint_activities",
  "zook_frogsleep_buddy_joint_goals",
  "zook_frogsleep_buddy_goal_contributions",
  "zook_frogsleep_buddy_milestones",
  "zook_frogsleep_buddy_weekly_reports",
  "zook_frogsleep_sleep_report_snapshots",
  "zook_frogsleep_progress_snapshots",
  "zook_frogsleep_entitlement_records",
] as const;

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
  if (appId !== "frogsleep") {
    return;
  }
  await query("DELETE FROM zook_frogsleep_devices WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  for (const tableName of FROGSLEEP_USER_RUNTIME_TABLES) {
    await query(
      `DELETE FROM ${tableName} WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)`,
      [appId, userId],
    );
  }
}
