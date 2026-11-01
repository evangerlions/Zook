import { PostgresBuddySupportRepository } from "./postgres-buddy-support-repository.ts";
type QueryFn = (sql: string, values?: unknown[]) => Promise<{ rows: unknown[] }>;

export async function deletePostgresFrogSleepBuddyUserData(query: QueryFn, appId: string,
  userId: string, runtimeTables: readonly string[]): Promise<void> {
  const owned = runtimeTables.map(table => `SELECT id FROM ${table}
    WHERE app_id = $1 AND (owner_user_id = $2 OR partner_user_id = $2)`);
  owned.push(`SELECT id FROM zook_frogsleep_buddy_invitation_bundles
    WHERE app_id = $1 AND (inviter_user_id = $2 OR invitee_user_id = $2
      OR recipient_email = (SELECT LOWER(BTRIM(email)) FROM zook_users WHERE id = $2))`,
  `SELECT id FROM zook_frogsleep_buddy_domain_relationships
    WHERE app_id = $1 AND (user_id_low = $2 OR user_id_high = $2)`);
  const result = await query(owned.join(" UNION "), [appId, userId]);
  const ids = result.rows.map(row => String((row as { id: string }).id));
  await new PostgresBuddySupportRepository(query).deleteUser(appId, userId, ids);
  await deleteDerivedNotifications(query, appId, userId, ids);
  await query(`UPDATE zook_frogsleep_buddy_domain_slots SET state = 'available',
    relationship_id = NULL, version = version + 1, updated_at = NOW()
    WHERE app_id = $1 AND relationship_id = ANY($3::text[]) AND user_id <> $2`, [appId, userId, ids]);
  await query("DELETE FROM zook_frogsleep_buddy_domain_slots WHERE app_id = $1 AND user_id = $2", [appId, userId]);
  await query(`DELETE FROM zook_frogsleep_buddy_sharing_grants WHERE app_id = $1
    AND (grantor_user_id = $2 OR grantee_user_id = $2)`, [appId, userId]);
  await deleteInvitations(query, appId, userId, ids);
  await query(`DELETE FROM zook_frogsleep_buddy_domain_relationships WHERE app_id = $1
    AND (user_id_low = $2 OR user_id_high = $2)`, [appId, userId]);
}

async function deleteInvitations(query: QueryFn, appId: string, userId: string, ids: string[]): Promise<void> {
  await query(`DELETE FROM zook_frogsleep_buddy_invitation_domain_decisions WHERE app_id = $1
    AND (invitation_id = ANY($3::text[]) OR decided_by_user_id = $2)`, [appId, userId, ids]);
  await query(`DELETE FROM zook_frogsleep_buddy_invitation_receipts WHERE app_id = $1
    AND (inviter_user_id = $2 OR invitee_user_id = $2 OR invitation_id = ANY($3::text[]))`, [appId, userId, ids]);
  await query(`DELETE FROM zook_frogsleep_buddy_invitation_receipt_attempts WHERE app_id = $1
    AND (inviter_user_id = $2 OR invitee_user_id = $2)`, [appId, userId]);
  await query(`DELETE FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id = $1
    AND id = ANY($2::text[])`, [appId, ids]);
}

async function deleteDerivedNotifications(query: QueryFn, appId: string, userId: string, ids: string[]): Promise<void> {
  await query(`DELETE FROM zook_frogsleep_buddy_notification_outbox WHERE app_id = $1
    AND (recipient_user_id = $2 OR target_id = ANY($3::text[]))`, [appId, userId, ids]);
  const targets = ["entityId", "relationshipId", "sessionId"].map(key => `payload->>'${key}' = ANY($3::text[])`);
  await query(`DELETE FROM zook_notification_jobs WHERE app_id = $1
    AND (recipient_user_id = $2 OR ${targets.join(" OR ")})`, [appId, userId, ids]);
}
