import type { UserSubscriptionRecord, SubscriptionEventRecord } from "../../../modules/bodylog/bodylog-subscription.types.ts";
import type { SubscriptionTier } from "../../../services/subscription.service.ts";

interface PostgresClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[] }>;
}

export class PostgresSubscriptionStore {
  constructor(private readonly query: (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>) {}

  async findActiveUserSubscription(appId: string, userId: string): Promise<UserSubscriptionRecord | null> {
    const now = new Date().toISOString();
    const result = await this.query(
      `SELECT id, app_id, user_id, tier, started_at, expires_at, original_transaction_id, auto_renew, created_at, updated_at
       FROM zook_user_subscriptions
       WHERE app_id = $1 AND user_id = $2 AND expires_at > $3
       ORDER BY tier DESC, expires_at DESC
       LIMIT 1`,
      [appId, userId, now]
    );
    return result.rows.length > 0 ? this.parseSubscription(result.rows[0]) : null;
  }

  async upsertUserSubscription(record: UserSubscriptionRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_user_subscriptions (id, app_id, user_id, tier, started_at, expires_at, original_transaction_id, auto_renew, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (id) DO UPDATE SET
         tier = EXCLUDED.tier,
         expires_at = EXCLUDED.expires_at,
         auto_renew = EXCLUDED.auto_renew,
         updated_at = EXCLUDED.updated_at`,
      [
        record.id,
        record.appId,
        record.userId,
        record.tier,
        record.startedAt,
        record.expiresAt,
        record.originalTransactionId,
        record.autoRenew,
        record.createdAt,
        record.updatedAt,
      ]
    );
  }

  async insertSubscriptionEvent(record: SubscriptionEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_subscription_events (id, subscription_id, event_type, tier, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        record.id,
        record.subscriptionId,
        record.eventType,
        record.tier,
        JSON.stringify(record.metadata),
        record.occurredAt,
      ]
    );
  }

  private parseSubscription(row: any): UserSubscriptionRecord {
    return {
      id: row.id,
      appId: row.app_id,
      userId: row.user_id,
      tier: row.tier as SubscriptionTier,
      startedAt: new Date(row.started_at).toISOString(),
      expiresAt: new Date(row.expires_at).toISOString(),
      originalTransactionId: row.original_transaction_id,
      autoRenew: row.auto_renew,
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }
}
