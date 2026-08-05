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
  await query("DELETE FROM zook_bodylog_challenge_members WHERE app_id = $1 AND challenge_id IN (SELECT challenge_id FROM zook_bodylog_challenge_members WHERE app_id = $1 AND user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_challenges WHERE app_id = $1 AND (creator_user_id = $2 OR id NOT IN (SELECT DISTINCT challenge_id FROM zook_bodylog_challenge_members WHERE app_id = $1))", [appId, userId]);
  await query("DELETE FROM zook_bodylog_invitation_attributions WHERE app_id = $1 AND (inviter_user_id = $2 OR invitee_user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_invitations WHERE app_id = $1 AND inviter_user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_bodylog_leaderboard_entries WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_bodylog_daily_aggregates WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_bodylog_weekly_goal_snapshots WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_bodylog_reports WHERE app_id = $1 AND (reporter_user_id = $2 OR reported_user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_blocks WHERE app_id = $1 AND (blocker_user_id = $2 OR blocked_user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_friendships WHERE app_id = $1 AND (user_id = $2 OR friend_user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_friend_requests WHERE app_id = $1 AND (sender_user_id = $2 OR recipient_user_id = $2)", [appId, userId]);
  await query("DELETE FROM zook_bodylog_profiles WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_user_roles WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_notification_jobs WHERE app_id = $1 AND recipient_user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_analytics_events WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_content_safety_checks WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_files WHERE app_id = $1 AND owner_user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_feedback_attachments WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_feedback WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_ai_output_reports WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query("DELETE FROM zook_ai_output_reactions WHERE app_id = $1 AND user_id = $2", [appId, userId]);
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
