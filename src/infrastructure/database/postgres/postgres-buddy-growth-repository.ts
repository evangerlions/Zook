import type {
  BuddyGrowthRepositoryProtocol,
  BuddyInvitationBundleRecord,
  BuddyInvitationPage,
  BuddyInvitationReceiptRecord,
  BuddyNotificationOutboxRecord,
  BuddySharingGrantRecord,
} from "../../../modules/frogsleep/buddy-growth/buddy-growth-repository.ts";
import type { FrogSleepBuddyNotificationDeliveryRecord, FrogSleepBuddyNotificationRecord } from "../../../shared/types.ts";

/** PostgreSQL persistence adapter for buddy growth projections and outbox. */
export class PostgresBuddyGrowthRepository implements BuddyGrowthRepositoryProtocol {
  constructor(private readonly pool: { query(sql: string, values?: unknown[]): Promise<{ rows: any[] }> }) {}

  async upsertGrant(record: BuddySharingGrantRecord): Promise<BuddySharingGrantRecord> {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_sharing_grants
       (id, app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category, state, version, granted_at, revoked_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category)
       DO UPDATE SET state=EXCLUDED.state, version=EXCLUDED.version, granted_at=EXCLUDED.granted_at,
         revoked_at=EXCLUDED.revoked_at, updated_at=EXCLUDED.updated_at RETURNING *`,
      [record.id, record.appId, record.relationshipId, record.grantorUserId, record.granteeUserId,
        record.domain, record.category, record.state, record.version, record.grantedAt, record.revokedAt,
        record.createdAt, record.updatedAt],
    );
    return mapGrant(result.rows[0]);
  }

  async listGrantsForViewer(appId: string, granteeUserId: string, relationshipId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_sharing_grants
       WHERE app_id=$1 AND grantee_user_id=$2 AND relationship_id=$3 ORDER BY domain, category`,
      [appId, granteeUserId, relationshipId],
    );
    return result.rows.map(mapGrant);
  }

  async listGrants(appId: string, relationshipId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_sharing_grants
       WHERE app_id=$1 AND relationship_id=$2 ORDER BY grantor_user_id, category`, [appId, relationshipId],
    );
    return result.rows.map(mapGrant);
  }

  async findGrant(appId: string, grantId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_sharing_grants WHERE app_id=$1 AND id=$2`, [appId, grantId],
    );
    return result.rows[0] ? mapGrant(result.rows[0]) : undefined;
  }

  async updateGrant(appId: string, grantId: string, expectedVersion: number, state: BuddySharingGrantRecord["state"]) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_sharing_grants SET state=$4, version=version+1, updated_at=NOW(),
       granted_at=CASE WHEN $4='granted' THEN NOW() ELSE granted_at END,
       revoked_at=CASE WHEN $4='revoked' THEN NOW() ELSE NULL END
       WHERE app_id=$1 AND id=$2 AND version=$3 RETURNING *`, [appId, grantId, expectedVersion, state],
    );
    return result.rows[0] ? mapGrant(result.rows[0]) : undefined;
  }

  async upsertInvitationReceipt(record: BuddyInvitationReceiptRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_receipts
       (id, app_id, invitation_kind, invitation_id, bundle_id, inviter_user_id, invitee_user_id, status, version,
        recipient_read_at, sender_read_at, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (app_id, invitation_kind, invitation_id) DO UPDATE SET status=EXCLUDED.status,
        version=EXCLUDED.version, recipient_read_at=EXCLUDED.recipient_read_at,
        sender_read_at=EXCLUDED.sender_read_at, updated_at=EXCLUDED.updated_at RETURNING *`,
      [record.id, record.appId, record.invitationKind, record.invitationId, record.bundleId, record.inviterUserId,
        record.inviteeUserId, record.status, record.version, record.recipientReadAt, record.senderReadAt,
        record.expiresAt, record.createdAt, record.updatedAt],
    );
    return mapReceipt(result.rows[0]);
  }

  async upsertBundle(record: BuddyInvitationBundleRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_bundles
       (id, app_id, inviter_user_id, invitee_user_id, status, domains, version, domain_invitation_ids,
        domain_error_codes, last_idempotency_key, last_response_action, response_payload,
        expires_at, responded_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, version=EXCLUDED.version,
        domain_invitation_ids=EXCLUDED.domain_invitation_ids, domain_error_codes=EXCLUDED.domain_error_codes,
        last_idempotency_key=EXCLUDED.last_idempotency_key, last_response_action=EXCLUDED.last_response_action,
        response_payload=EXCLUDED.response_payload, responded_at=EXCLUDED.responded_at,
        updated_at=EXCLUDED.updated_at RETURNING *`,
      [record.id, record.appId, record.inviterUserId, record.inviteeUserId, record.status, record.domains,
        record.version, record.domainInvitationIds, record.domainErrorCodes, record.lastIdempotencyKey,
        record.lastResponseAction, record.responsePayload, record.expiresAt, record.respondedAt,
        record.createdAt, record.updatedAt],
    );
    return mapBundle(result.rows[0]);
  }

  async findBundle(appId: string, bundleId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND id=$2`, [appId, bundleId],
    );
    return result.rows[0] ? mapBundle(result.rows[0]) : undefined;
  }

  async listBundles(input: { appId: string; userId: string; direction: "incoming" | "outgoing" }) {
    const column = input.direction === "incoming" ? "invitee_user_id" : "inviter_user_id";
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND ${column}=$2
       ORDER BY created_at DESC, id DESC`, [input.appId, input.userId],
    );
    return result.rows.map(mapBundle);
  }

  async listInvitationInbox(input: { appId: string; userId: string; limit: number; cursor?: string }) {
    return this.listReceipts("invitee_user_id", input);
  }

  async listInvitationOutbox(input: { appId: string; userId: string; limit: number; cursor?: string }) {
    return this.listReceipts("inviter_user_id", input);
  }

  async enqueueNotification(record: BuddyNotificationOutboxRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_notification_outbox
       (id, app_id, recipient_user_id, event_type, target_type, target_id, deduplication_key, safe_route,
        status, attempt_count, available_at, processed_at, last_error_code, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (app_id, deduplication_key) DO UPDATE SET deduplication_key=EXCLUDED.deduplication_key RETURNING *`,
      [record.id, record.appId, record.recipientUserId, record.eventType, record.targetType, record.targetId,
        record.deduplicationKey, record.safeRoute, record.status, record.attemptCount, record.availableAt,
        record.processedAt, record.lastErrorCode, record.createdAt, record.updatedAt],
    );
    return mapOutbox(result.rows[0]);
  }

  async listReadyNotifications(nowIso: string, limit: number) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_notification_outbox
       WHERE status IN ('pending','failed') AND available_at <= $1 ORDER BY created_at LIMIT $2`,
      [nowIso, limit],
    );
    return result.rows.map(mapOutbox);
  }

  async updateNotificationOutbox(id: string, patch: Partial<BuddyNotificationOutboxRecord>) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_notification_outbox SET status=COALESCE($2,status),
       attempt_count=COALESCE($3,attempt_count), processed_at=COALESCE($4,processed_at),
       last_error_code=$5, updated_at=COALESCE($6,updated_at) WHERE id=$1 RETURNING *`,
      [id, patch.status, patch.attemptCount, patch.processedAt, patch.lastErrorCode, patch.updatedAt],
    );
    return result.rows[0] ? mapOutbox(result.rows[0]) : undefined;
  }

  async upsertNotification(record: FrogSleepBuddyNotificationRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_notifications
       (id,app_id,recipient_user_id,outbox_id,notification_type,target_type,target_id,safe_route,read_at,expires_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       ON CONFLICT (app_id,recipient_user_id,outbox_id) DO UPDATE SET outbox_id=EXCLUDED.outbox_id RETURNING *`,
      [record.id, record.appId, record.recipientUserId, record.outboxId, record.notificationType,
        record.targetType, record.targetId, record.safeRoute, record.readAt, record.expiresAt,
        record.createdAt, record.updatedAt],
    );
    return mapNotification(result.rows[0]);
  }

  async findNotification(appId: string, recipientUserId: string, notificationId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_notifications WHERE app_id=$1 AND recipient_user_id=$2 AND id=$3`,
      [appId, recipientUserId, notificationId],
    );
    return result.rows[0] ? mapNotification(result.rows[0]) : undefined;
  }

  async listNotifications(input: { appId: string; recipientUserId: string; limit: number; cursor?: string }) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_notifications WHERE app_id=$1 AND recipient_user_id=$2
       AND ($3::text IS NULL OR (created_at::text || '|' || id) < $3)
       ORDER BY created_at DESC,id DESC LIMIT $4`, [input.appId, input.recipientUserId, input.cursor, input.limit],
    );
    const items = result.rows.map(mapNotification); const last = items.at(-1);
    return { items, nextCursor: items.length === input.limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }

  async countUnreadNotifications(appId: string, recipientUserId: string) {
    const result = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM zook_frogsleep_buddy_notifications WHERE app_id=$1 AND recipient_user_id=$2 AND read_at IS NULL`,
      [appId, recipientUserId],
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async markNotificationRead(appId: string, recipientUserId: string, notificationId: string, readAt: string) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_notifications SET read_at=COALESCE(read_at,$4),updated_at=$4
       WHERE app_id=$1 AND recipient_user_id=$2 AND id=$3 RETURNING *`, [appId, recipientUserId, notificationId, readAt],
    );
    return result.rows[0] ? mapNotification(result.rows[0]) : undefined;
  }

  async markAllNotificationsRead(appId: string, recipientUserId: string, readAt: string) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_notifications SET read_at=$3,updated_at=$3
       WHERE app_id=$1 AND recipient_user_id=$2 AND read_at IS NULL RETURNING id`, [appId, recipientUserId, readAt],
    );
    return result.rows.length;
  }

  async insertNotificationDelivery(record: FrogSleepBuddyNotificationDeliveryRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_notification_deliveries
       (id,app_id,notification_id,channel,status,attempt,provider_message_id,error_code,delivered_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (notification_id,channel,attempt) DO UPDATE SET notification_id=EXCLUDED.notification_id RETURNING *`,
      [record.id, record.appId, record.notificationId, record.channel, record.status, record.attempt,
        record.providerMessageId, record.errorCode, record.deliveredAt, record.createdAt],
    );
    return mapDelivery(result.rows[0]);
  }

  private async listReceipts(column: "invitee_user_id" | "inviter_user_id", input: { appId: string; userId: string; limit: number; cursor?: string }): Promise<BuddyInvitationPage> {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_receipts WHERE app_id=$1 AND ${column}=$2
       AND ($3::text IS NULL OR (created_at::text || '|' || id) < $3) ORDER BY created_at DESC, id DESC LIMIT $4`,
      [input.appId, input.userId, input.cursor, input.limit],
    );
    const items = result.rows.map(mapReceipt);
    const last = items.at(-1);
    return { items, nextCursor: items.length === input.limit && last ? `${last.createdAt}|${last.id}` : undefined };
  }
}

const iso = (value: unknown): string | undefined => value ? new Date(value as string).toISOString() : undefined;
const mapGrant = (row: any): BuddySharingGrantRecord => ({ id: row.id, appId: row.app_id, relationshipId: row.relationship_id, grantorUserId: row.grantor_user_id, granteeUserId: row.grantee_user_id, domain: row.domain, category: row.category, state: row.state, version: row.version, grantedAt: iso(row.granted_at), revokedAt: iso(row.revoked_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapReceipt = (row: any): BuddyInvitationReceiptRecord => ({ id: row.id, appId: row.app_id, invitationKind: row.invitation_kind, invitationId: row.invitation_id, bundleId: row.bundle_id ?? undefined, inviterUserId: row.inviter_user_id, inviteeUserId: row.invitee_user_id ?? undefined, status: row.status, version: row.version, recipientReadAt: iso(row.recipient_read_at), senderReadAt: iso(row.sender_read_at), expiresAt: iso(row.expires_at)!, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapOutbox = (row: any): BuddyNotificationOutboxRecord => ({ id: row.id, appId: row.app_id, recipientUserId: row.recipient_user_id, eventType: row.event_type, targetType: row.target_type, targetId: row.target_id, deduplicationKey: row.deduplication_key, safeRoute: row.safe_route, status: row.status, attemptCount: row.attempt_count, availableAt: iso(row.available_at)!, processedAt: iso(row.processed_at), lastErrorCode: row.last_error_code ?? undefined, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapBundle = (row: any): BuddyInvitationBundleRecord => ({ id: row.id, appId: row.app_id, inviterUserId: row.inviter_user_id, inviteeUserId: row.invitee_user_id ?? undefined, status: row.status, domains: row.domains, version: row.version, domainInvitationIds: row.domain_invitation_ids ?? {}, domainErrorCodes: row.domain_error_codes ?? {}, lastIdempotencyKey: row.last_idempotency_key ?? undefined, lastResponseAction: row.last_response_action ?? undefined, responsePayload: row.response_payload ?? undefined, expiresAt: iso(row.expires_at)!, respondedAt: iso(row.responded_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapNotification = (row: any): FrogSleepBuddyNotificationRecord => ({ id: row.id, appId: row.app_id, recipientUserId: row.recipient_user_id, outboxId: row.outbox_id, notificationType: row.notification_type, targetType: row.target_type, targetId: row.target_id, safeRoute: row.safe_route ?? {}, readAt: iso(row.read_at), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapDelivery = (row: any): FrogSleepBuddyNotificationDeliveryRecord => ({ id: row.id, appId: row.app_id, notificationId: row.notification_id, channel: row.channel, status: row.status, attempt: row.attempt, providerMessageId: row.provider_message_id ?? undefined, errorCode: row.error_code ?? undefined, deliveredAt: iso(row.delivered_at), createdAt: iso(row.created_at)! });
