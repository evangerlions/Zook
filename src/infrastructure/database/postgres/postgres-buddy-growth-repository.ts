import type {
  BuddyGrowthRepositoryProtocol,
  BuddyInvitationBundleRecord,
  BuddyInvitationPage,
  BuddyInvitationReceiptRecord,
  BuddyNotificationOutboxRecord,
  BuddySharingGrantRecord,
} from "../../../modules/frogsleep/buddy-growth/buddy-growth-repository.ts";
import type { FrogSleepBuddyInvitationDomainDecisionRecord, FrogSleepBuddyNotificationDeliveryRecord,
  FrogSleepBuddyNotificationRecord, FrogSleepBuddyInvitationReceiptAttemptRecord,
  FrogSleepBuddyDomainSlotRecord, FrogSleepBuddyInvitationEmailAttemptRecord,
  FrogSleepBuddyInvitationEmailDeliveryRecord } from "../../../shared/types.ts";
import type { FrogSleepBuddyDomainRelationshipRecord } from "../../../shared/types.ts";
import {
  normalizeFrogSleepBuddyDomainRelationship,
  normalizeFrogSleepBuddyDomainRelationshipUpdate,
  type FrogSleepBuddyDomainRelationshipUpdate,
} from "../../../modules/frogsleep/buddy-growth/buddy-domain-relationship-validation.ts";

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
       (id, app_id, inviter_user_id, invitee_user_id, recipient_email, recipient_email_hash,
        share_code, handoff_token, share_link, locale, status, domains, version, domain_invitation_ids,
        domain_error_codes, last_idempotency_key, last_response_action, response_payload,
        expires_at, responded_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, version=EXCLUDED.version,
        invitee_user_id=EXCLUDED.invitee_user_id, recipient_email=EXCLUDED.recipient_email,
        recipient_email_hash=EXCLUDED.recipient_email_hash, share_link=EXCLUDED.share_link,
        domain_invitation_ids=EXCLUDED.domain_invitation_ids, domain_error_codes=EXCLUDED.domain_error_codes,
        last_idempotency_key=EXCLUDED.last_idempotency_key, last_response_action=EXCLUDED.last_response_action,
        response_payload=EXCLUDED.response_payload, responded_at=EXCLUDED.responded_at,
        updated_at=EXCLUDED.updated_at RETURNING *`,
      [record.id, record.appId, record.inviterUserId, record.inviteeUserId, record.recipientEmail,
        record.recipientEmailHash, record.shareCode, record.handoffToken, record.shareLink, record.locale,
        record.status, record.domains, record.version, record.domainInvitationIds, record.domainErrorCodes,
        record.lastIdempotencyKey, record.lastResponseAction, record.responsePayload, record.expiresAt,
        record.respondedAt, record.createdAt, record.updatedAt],
    );
    return mapBundle(result.rows[0]);
  }

  async findBundle(appId: string, bundleId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND id=$2`, [appId, bundleId],
    );
    return result.rows[0] ? mapBundle(result.rows[0]) : undefined;
  }

  async listBundles(input: {
    appId: string; userId: string; direction: "incoming" | "outgoing";
    recipientEmailHash?: string; recipientEmail?: string;
  }) {
    if (input.direction === "incoming") {
      const result = await this.pool.query(
        `SELECT * FROM zook_frogsleep_buddy_invitation_bundles
         WHERE app_id=$1 AND (invitee_user_id=$2
           OR (invitee_user_id IS NULL AND
             (recipient_email_hash=$3 OR LOWER(recipient_email)=LOWER($4))))
         ORDER BY created_at DESC, id DESC`,
        [input.appId, input.userId, input.recipientEmailHash ?? null, input.recipientEmail ?? null],
      );
      return result.rows.map(mapBundle);
    }
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND inviter_user_id=$2
       ORDER BY created_at DESC, id DESC`, [input.appId, input.userId],
    );
    return result.rows.map(mapBundle);
  }

  async findBundleByCode(appId: string, code: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles
       WHERE app_id=$1 AND UPPER(share_code)=UPPER($2)`,
      [appId, code.trim()],
    );
    return result.rows[0] ? mapBundle(result.rows[0]) : undefined;
  }

  async findBundleByToken(appId: string, token: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_bundles WHERE app_id=$1 AND handoff_token=$2`,
      [appId, token.trim()],
    );
    return result.rows[0] ? mapBundle(result.rows[0]) : undefined;
  }

  async enqueueInvitationEmailDelivery(record: FrogSleepBuddyInvitationEmailDeliveryRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_email_deliveries
       (id,app_id,invitation_id,recipient_email,recipient_email_hash,locale,status,attempt_count,
        available_at,provider_request_id,provider_message_id,last_error_code,provider_accepted_at,
        delivered_at,bounced_at,suppressed_at,dead_lettered_at,created_at,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (app_id,invitation_id) DO UPDATE SET invitation_id=EXCLUDED.invitation_id
       RETURNING *`,
      [record.id, record.appId, record.invitationId, record.recipientEmail, record.recipientEmailHash,
        record.locale, record.status, record.attemptCount, record.availableAt, record.providerRequestId,
        record.providerMessageId, record.lastErrorCode, record.providerAcceptedAt, record.deliveredAt,
        record.bouncedAt, record.suppressedAt, record.deadLetteredAt, record.createdAt, record.updatedAt],
    );
    return mapInvitationEmailDelivery(result.rows[0]);
  }
  async findInvitationEmailDelivery(appId: string, invitationId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_email_deliveries
       WHERE app_id=$1 AND invitation_id=$2`,
      [appId, invitationId],
    );
    return result.rows[0] ? mapInvitationEmailDelivery(result.rows[0]) : undefined;
  }

  async findInvitationEmailDeliveryByProviderMessageId(providerMessageId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_email_deliveries
       WHERE provider_message_id=$1`,
      [providerMessageId],
    );
    return result.rows[0] ? mapInvitationEmailDelivery(result.rows[0]) : undefined;
  }

  async listInvitationEmailDeliveries(filter: {
    invitationId?: string;
    status?: FrogSleepBuddyInvitationEmailDeliveryRecord["status"];
    limit?: number;
  } = {}) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_email_deliveries
       WHERE ($1::text IS NULL OR invitation_id=$1)
         AND ($2::text IS NULL OR status=$2)
       ORDER BY created_at DESC,id DESC LIMIT $3`,
      [filter.invitationId ?? null, filter.status ?? null, Math.max(1, Math.min(filter.limit ?? 100, 500))],
    );
    return result.rows.map(mapInvitationEmailDelivery);
  }

  async claimReadyInvitationEmailDeliveries(nowIso: string, limit: number) {
    const result = await this.pool.query(
      `WITH ready AS (
         SELECT id
         FROM zook_frogsleep_buddy_invitation_email_deliveries
         WHERE (status IN ('queued','retryable_failed') AND available_at <= $1)
            OR (status='processing' AND updated_at <= $1::timestamptz - INTERVAL '15 minutes')
         ORDER BY created_at,id
         FOR UPDATE SKIP LOCKED
         LIMIT $2
       )
       UPDATE zook_frogsleep_buddy_invitation_email_deliveries AS delivery
       SET status='processing',
           attempt_count=delivery.attempt_count + 1,
           last_error_code=NULL,
           updated_at=$1
       FROM ready
       WHERE delivery.id=ready.id
       RETURNING delivery.*`,
      [nowIso, limit],
    );
    return result.rows.map(mapInvitationEmailDelivery);
  }

  async updateInvitationEmailDelivery(
    id: string,
    patch: Partial<FrogSleepBuddyInvitationEmailDeliveryRecord>,
  ) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_invitation_email_deliveries SET
       recipient_email=COALESCE($2,recipient_email), recipient_email_hash=COALESCE($3,recipient_email_hash),
       locale=COALESCE($4,locale), status=COALESCE($5,status),
       attempt_count=COALESCE($6,attempt_count), available_at=COALESCE($7,available_at),
       provider_request_id=COALESCE($8,provider_request_id),
       provider_message_id=COALESCE($9,provider_message_id), last_error_code=$10,
       provider_accepted_at=COALESCE($11,provider_accepted_at),
       delivered_at=COALESCE($12,delivered_at), bounced_at=COALESCE($13,bounced_at),
       suppressed_at=COALESCE($14,suppressed_at), dead_lettered_at=COALESCE($15,dead_lettered_at),
       updated_at=COALESCE($16,updated_at)
       WHERE id=$1 RETURNING *`,
      [id, patch.recipientEmail, patch.recipientEmailHash, patch.locale, patch.status, patch.attemptCount,
        patch.availableAt, patch.providerRequestId, patch.providerMessageId, patch.lastErrorCode ?? null,
        patch.providerAcceptedAt, patch.deliveredAt, patch.bouncedAt, patch.suppressedAt,
        patch.deadLetteredAt, patch.updatedAt],
    );
    return result.rows[0] ? mapInvitationEmailDelivery(result.rows[0]) : undefined;
  }

  async insertInvitationEmailAttempt(record: FrogSleepBuddyInvitationEmailAttemptRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_email_attempts
       (id,app_id,delivery_id,invitation_id,attempt,status,provider_request_id,
        provider_message_id,error_code,created_at,completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (delivery_id,attempt) DO UPDATE SET
         status=EXCLUDED.status,provider_request_id=EXCLUDED.provider_request_id,
         provider_message_id=EXCLUDED.provider_message_id,error_code=EXCLUDED.error_code,
         completed_at=EXCLUDED.completed_at RETURNING *`,
      [record.id, record.appId, record.deliveryId, record.invitationId, record.attempt, record.status,
        record.providerRequestId, record.providerMessageId, record.errorCode, record.createdAt,
        record.completedAt],
    );
    return mapInvitationEmailAttempt(result.rows[0]);
  }

  async listInvitationEmailAttempts(appId: string, deliveryId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_email_attempts
       WHERE app_id=$1 AND delivery_id=$2 ORDER BY attempt`,
      [appId, deliveryId],
    );
    return result.rows.map(mapInvitationEmailAttempt);
  }

  async upsertInvitationDomainDecision(record: FrogSleepBuddyInvitationDomainDecisionRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_domain_decisions
       (app_id, invitation_id, domain, status, version, decided_by_user_id, decided_at,
        idempotency_key_hash, terminal_reason, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (app_id, invitation_id, domain) DO UPDATE SET
         status=EXCLUDED.status, version=EXCLUDED.version, decided_by_user_id=EXCLUDED.decided_by_user_id,
         decided_at=EXCLUDED.decided_at, idempotency_key_hash=EXCLUDED.idempotency_key_hash,
         terminal_reason=EXCLUDED.terminal_reason, updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.appId, record.invitationId, record.domain, record.status, record.version,
        record.decidedByUserId, record.decidedAt, record.idempotencyKeyHash, record.terminalReason,
        record.createdAt, record.updatedAt],
    );
    return mapDomainDecision(result.rows[0]);
  }

  async findInvitationDomainDecision(
    appId: string,
    invitationId: string,
    domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"],
  ) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_domain_decisions
       WHERE app_id=$1 AND invitation_id=$2 AND domain=$3`, [appId, invitationId, domain],
    );
    return result.rows[0] ? mapDomainDecision(result.rows[0]) : undefined;
  }

  async listInvitationDomainDecisions(appId: string, invitationId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_domain_decisions
       WHERE app_id=$1 AND invitation_id=$2 ORDER BY domain ASC`, [appId, invitationId],
    );
    return result.rows.map(mapDomainDecision);
  }

  async compareAndUpdateInvitationDomainDecision(input: {
    appId: string; invitationId: string; domain: FrogSleepBuddyInvitationDomainDecisionRecord["domain"];
    expectedVersion: number; status: FrogSleepBuddyInvitationDomainDecisionRecord["status"];
    decidedByUserId: string; decidedAt: string; idempotencyKeyHash: string; terminalReason?: string; updatedAt: string;
  }) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_invitation_domain_decisions
       SET status=$5, version=version+1, decided_by_user_id=$6, decided_at=$7,
           idempotency_key_hash=$8, terminal_reason=$9, updated_at=$10
       WHERE app_id=$1 AND invitation_id=$2 AND domain=$3 AND version=$4 AND status='pending'
       RETURNING *`,
      [input.appId, input.invitationId, input.domain, input.expectedVersion, input.status,
        input.decidedByUserId, input.decidedAt, input.idempotencyKeyHash, input.terminalReason ?? null, input.updatedAt],
    );
    return result.rows[0] ? mapDomainDecision(result.rows[0]) : undefined;
  }

  async ensureDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; now: string;
  }) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_domain_slots
       (app_id, user_id, domain, state, relationship_id, version, created_at, updated_at)
       VALUES ($1,$2,$3,'available',NULL,1,$4,$4)
       ON CONFLICT (app_id, user_id, domain) DO NOTHING
       RETURNING *`,
      [input.appId, input.userId, input.domain, input.now],
    );
    if (result.rows[0]) return mapDomainSlot(result.rows[0]);
    const existing = await this.findDomainSlot(input.appId, input.userId, input.domain);
    if (!existing) throw new Error("FrogSleep buddy domain slot was not found after ensure.");
    return existing;
  }

  async findDomainSlot(appId: string, userId: string, domain: FrogSleepBuddyDomainSlotRecord["domain"]) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_domain_slots WHERE app_id=$1 AND user_id=$2 AND domain=$3`,
      [appId, userId, domain],
    );
    return result.rows[0] ? mapDomainSlot(result.rows[0]) : undefined;
  }

  async listDomainSlots(appId: string, userId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_domain_slots WHERE app_id=$1 AND user_id=$2 ORDER BY domain ASC`,
      [appId, userId],
    );
    return result.rows.map(mapDomainSlot);
  }

  async compareAndUpdateDomainSlot(input: {
    appId: string; userId: string; domain: FrogSleepBuddyDomainSlotRecord["domain"]; expectedVersion: number;
    state: FrogSleepBuddyDomainSlotRecord["state"]; relationshipId?: string; updatedAt: string;
  }) {
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_domain_slots
       SET state=$5, relationship_id=$6, version=version+1, updated_at=$7
       WHERE app_id=$1 AND user_id=$2 AND domain=$3 AND version=$4
       RETURNING *`,
      [input.appId, input.userId, input.domain, input.expectedVersion, input.state, input.relationshipId, input.updatedAt],
    );
    return result.rows[0] ? mapDomainSlot(result.rows[0]) : undefined;
  }

  async insertDomainRelationship(record: FrogSleepBuddyDomainRelationshipRecord) {
    const normalized = normalizeFrogSleepBuddyDomainRelationship(record);
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_domain_relationships
       (id, app_id, domain, user_id_low, user_id_high, status, paused_by_user_ids,
        version, revoked_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO NOTHING RETURNING *`,
      [normalized.id, normalized.appId, normalized.domain, normalized.userIdLow, normalized.userIdHigh,
        normalized.status, normalized.pausedByUserIds, normalized.version, normalized.revokedAt,
        normalized.createdAt, normalized.updatedAt],
    );
    if (result.rows[0]) return mapDomainRelationship(result.rows[0]);
    const existing = await this.findDomainRelationship(normalized.appId, normalized.id);
    if (!existing) throw new Error("FrogSleep buddy domain relationship ID collision.");
    return existing;
  }

  async findDomainRelationship(appId: string, relationshipId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_domain_relationships WHERE app_id=$1 AND id=$2`,
      [appId, relationshipId],
    );
    return result.rows[0] ? mapDomainRelationship(result.rows[0]) : undefined;
  }

  async listCurrentDomainRelationships(
    appId: string, userId: string, domain: FrogSleepBuddyDomainRelationshipRecord["domain"],
  ) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_domain_relationships
       WHERE app_id=$1 AND (user_id_low=$2 OR user_id_high=$2) AND domain=$3
         AND status IN ('active','paused')
       ORDER BY updated_at DESC, id DESC`,
      [appId, userId, domain],
    );
    return result.rows.map(mapDomainRelationship);
  }

  async compareAndUpdateDomainRelationship(input: FrogSleepBuddyDomainRelationshipUpdate) {
    const normalized = normalizeFrogSleepBuddyDomainRelationshipUpdate(input);
    const result = await this.pool.query(
      `UPDATE zook_frogsleep_buddy_domain_relationships
       SET status=$4, paused_by_user_ids=$5, revoked_at=$6, version=version+1, updated_at=$7
       WHERE app_id=$1 AND id=$2 AND version=$3 RETURNING *`,
      [normalized.appId, normalized.id, normalized.expectedVersion, normalized.status,
        normalized.pausedByUserIds, normalized.revokedAt, normalized.updatedAt],
    );
    return result.rows[0] ? mapDomainRelationship(result.rows[0]) : undefined;
  }

  async upsertInvitationReceiptAttempt(record: FrogSleepBuddyInvitationReceiptAttemptRecord) {
    const result = await this.pool.query(
      `INSERT INTO zook_frogsleep_buddy_invitation_receipt_attempts
       (id, app_id, inviter_user_id, invitee_user_id, recipient_identity_hash, domains, domains_fingerprint,
        status, expires_at, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (app_id, inviter_user_id, recipient_identity_hash, domains_fingerprint) DO UPDATE SET
         updated_at=EXCLUDED.updated_at
       RETURNING *`,
      [record.id, record.appId, record.inviterUserId, record.inviteeUserId, record.recipientIdentityHash,
        record.domains, record.domainsFingerprint, record.status, record.expiresAt, record.createdAt, record.updatedAt],
    );
    return mapReceiptAttempt(result.rows[0]);
  }

  async findInvitationReceiptAttempt(appId: string, inviterUserId: string, recipientIdentityHash: string, domainsFingerprint: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_receipt_attempts
       WHERE app_id=$1 AND inviter_user_id=$2 AND recipient_identity_hash=$3 AND domains_fingerprint=$4`,
      [appId, inviterUserId, recipientIdentityHash, domainsFingerprint],
    );
    return result.rows[0] ? mapReceiptAttempt(result.rows[0]) : undefined;
  }

  async findInvitationReceiptAttemptById(appId: string, inviterUserId: string, receiptId: string) {
    const result = await this.pool.query(
      `SELECT * FROM zook_frogsleep_buddy_invitation_receipt_attempts
       WHERE app_id=$1 AND inviter_user_id=$2 AND id=$3`, [appId, inviterUserId, receiptId],
    );
    return result.rows[0] ? mapReceiptAttempt(result.rows[0]) : undefined;
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
const mapBundle = (row: any): BuddyInvitationBundleRecord => ({ id: row.id, appId: row.app_id, inviterUserId: row.inviter_user_id, inviteeUserId: row.invitee_user_id ?? undefined, recipientEmail: row.recipient_email ?? undefined, recipientEmailHash: row.recipient_email_hash ?? undefined, shareCode: row.share_code, handoffToken: row.handoff_token, shareLink: row.share_link, locale: row.locale ?? "zh-CN", status: row.status, domains: row.domains, version: row.version, domainInvitationIds: row.domain_invitation_ids ?? {}, domainErrorCodes: row.domain_error_codes ?? {}, lastIdempotencyKey: row.last_idempotency_key ?? undefined, lastResponseAction: row.last_response_action ?? undefined, responsePayload: row.response_payload ?? undefined, expiresAt: iso(row.expires_at)!, respondedAt: iso(row.responded_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapInvitationEmailDelivery = (row: any): FrogSleepBuddyInvitationEmailDeliveryRecord => ({ id: row.id, appId: row.app_id, invitationId: row.invitation_id, recipientEmail: row.recipient_email, recipientEmailHash: row.recipient_email_hash, locale: row.locale, status: row.status, attemptCount: row.attempt_count, availableAt: iso(row.available_at)!, providerRequestId: row.provider_request_id ?? undefined, providerMessageId: row.provider_message_id ?? undefined, lastErrorCode: row.last_error_code ?? undefined, providerAcceptedAt: iso(row.provider_accepted_at), deliveredAt: iso(row.delivered_at), bouncedAt: iso(row.bounced_at), suppressedAt: iso(row.suppressed_at), deadLetteredAt: iso(row.dead_lettered_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapInvitationEmailAttempt = (row: any): FrogSleepBuddyInvitationEmailAttemptRecord => ({ id: row.id, appId: row.app_id, deliveryId: row.delivery_id, invitationId: row.invitation_id, attempt: row.attempt, status: row.status, providerRequestId: row.provider_request_id ?? undefined, providerMessageId: row.provider_message_id ?? undefined, errorCode: row.error_code ?? undefined, createdAt: iso(row.created_at)!, completedAt: iso(row.completed_at) });
const mapDomainDecision = (row: any): FrogSleepBuddyInvitationDomainDecisionRecord => ({ appId: row.app_id, invitationId: row.invitation_id, domain: row.domain, status: row.status, version: row.version, decidedByUserId: row.decided_by_user_id ?? undefined, decidedAt: iso(row.decided_at), idempotencyKeyHash: row.idempotency_key_hash ?? undefined, terminalReason: row.terminal_reason ?? undefined, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapDomainSlot = (row: any): FrogSleepBuddyDomainSlotRecord => ({ appId: row.app_id, userId: row.user_id, domain: row.domain, state: row.state, relationshipId: row.relationship_id ?? undefined, version: row.version, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapDomainRelationship = (row: any): FrogSleepBuddyDomainRelationshipRecord => ({ id: row.id, appId: row.app_id, domain: row.domain, userIdLow: row.user_id_low, userIdHigh: row.user_id_high, status: row.status, pausedByUserIds: row.paused_by_user_ids, version: row.version, revokedAt: iso(row.revoked_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapReceiptAttempt = (row: any): FrogSleepBuddyInvitationReceiptAttemptRecord => ({ id: row.id, appId: row.app_id, inviterUserId: row.inviter_user_id, inviteeUserId: row.invitee_user_id ?? undefined, recipientIdentityHash: row.recipient_identity_hash, domains: row.domains, domainsFingerprint: row.domains_fingerprint, status: row.status, expiresAt: iso(row.expires_at)!, createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapNotification = (row: any): FrogSleepBuddyNotificationRecord => ({ id: row.id, appId: row.app_id, recipientUserId: row.recipient_user_id, outboxId: row.outbox_id, notificationType: row.notification_type, targetType: row.target_type, targetId: row.target_id, safeRoute: row.safe_route ?? {}, readAt: iso(row.read_at), expiresAt: iso(row.expires_at), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at)! });
const mapDelivery = (row: any): FrogSleepBuddyNotificationDeliveryRecord => ({ id: row.id, appId: row.app_id, notificationId: row.notification_id, channel: row.channel, status: row.status, attempt: row.attempt, providerMessageId: row.provider_message_id ?? undefined, errorCode: row.error_code ?? undefined, deliveredAt: iso(row.delivered_at), createdAt: iso(row.created_at)! });
