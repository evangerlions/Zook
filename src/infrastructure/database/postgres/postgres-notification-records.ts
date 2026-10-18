import type { FrogSleepBuddyNotificationDeliveryRecord } from "../../../shared/types.ts";

type Query = (sql: string, values: unknown[]) => Promise<{ rows: any[] }>;

/** Marks uncertain email handoffs terminal and atomically claims only known ready deliveries. */
export async function claimNotificationEmails(query: Query, nowIso: string, limit: number) {
    await query(`UPDATE zook_frogsleep_buddy_invitation_email_deliveries SET status='dead_letter',
      last_error_code='PROVIDER_OUTCOME_UNKNOWN',dead_lettered_at=$1,updated_at=$1
      WHERE status='processing' AND updated_at <= $1::timestamptz - INTERVAL '15 minutes'`, [nowIso]);
    const result = await query(
      `WITH ready AS (
         SELECT id
         FROM zook_frogsleep_buddy_invitation_email_deliveries
         WHERE (status IN ('queued','retryable_failed') AND available_at <= $1)
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
    return result.rows;
  }


/** Maintains one logical channel result without downgrading completed Push on an outbox replay. */
export async function saveNotificationDelivery(query: Query, record: FrogSleepBuddyNotificationDeliveryRecord) {
    const result = await query(
      `INSERT INTO zook_frogsleep_buddy_notification_deliveries
       (id,app_id,notification_id,channel,status,attempt,provider_message_id,error_code,delivered_at,created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (notification_id,channel,attempt) DO UPDATE SET
       status=CASE WHEN EXCLUDED.status='pending' AND zook_frogsleep_buddy_notification_deliveries.status IN ('provider_accepted','delivered','suppressed')
         THEN zook_frogsleep_buddy_notification_deliveries.status ELSE EXCLUDED.status END,
       error_code=CASE WHEN EXCLUDED.status='pending' AND zook_frogsleep_buddy_notification_deliveries.status IN ('provider_accepted','delivered','suppressed')
         THEN zook_frogsleep_buddy_notification_deliveries.error_code ELSE EXCLUDED.error_code END,
       delivered_at=COALESCE(EXCLUDED.delivered_at,zook_frogsleep_buddy_notification_deliveries.delivered_at)
       RETURNING *`,
      [record.id, record.appId, record.notificationId, record.channel, record.status, record.attempt,
        record.providerMessageId, record.errorCode, record.deliveredAt, record.createdAt],
    );
    return result.rows[0];
  }

