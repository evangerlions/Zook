import { billingEnvironment } from "../../../modules/billing/billing-environment.ts";
import type { QueryResult, QueryResultRow } from "pg";
import type { AlipayOrder } from "../../../modules/billing/alipay-models.ts";
type Query = (sql: string, values?: unknown[]) => Promise<QueryResult<QueryResultRow>>;

export class PostgresAlipayOrders {
  constructor(private readonly query: Query) {}
  private async find(sql: string, values: unknown[]): Promise<AlipayOrder | undefined> {
    return (await this.query(sql, values)).rows[0]?.record as AlipayOrder | undefined;
  }
  findOrder(orderId: string) { return this.find("SELECT record FROM zook_ai_novel_alipay_orders WHERE order_id = $1", [orderId]); }
  findIdempotency(userId: string, key: string) { return this.find("SELECT record FROM zook_ai_novel_alipay_orders WHERE app_id = 'ai_novel' AND user_id = $1 AND idempotency_key = $2", [userId, key]); }
  async listRecovery(environment: string, merchant: string, seller: string, limit: number): Promise<AlipayOrder[]> {
    const result = await this.query(`SELECT record FROM zook_ai_novel_alipay_orders
      WHERE environment = $1 AND record->>'merchantAppId' = $2 AND record->>'sellerId' = $3
      AND (status = 'pending' OR (status = 'paid' AND NOT membership_applied AND record->>'accountDeletedAt' IS NULL))
      ORDER BY COALESCE(record->>'lastRecoveryAt', record->>'createdAt'), order_id LIMIT $4`,
    [environment, merchant, seller, limit]);
    return result.rows.map(row => row.record as AlipayOrder);
  }
  async listOrders(userId: string, filter: { before: string; after?: string; limit: number }): Promise<AlipayOrder[]> {
    const result = await this.query(`SELECT record FROM zook_ai_novel_alipay_orders
      WHERE user_id = $1 AND environment = $2 AND (record->>'createdAt')::timestamptz <= $3::timestamptz
      AND ($4::text IS NULL OR order_id > $4) ORDER BY order_id LIMIT $5`,
      [userId, billingEnvironment(), filter.before, filter.after ?? null, filter.limit]);
    return result.rows.map(row => row.record as AlipayOrder);
  }
  async listAccess(userId: string, now: string): Promise<AlipayOrder[]> {
    const result = await this.query(`SELECT DISTINCT ON (split_part(record->>'productKey', '_', 1)) record
      FROM zook_ai_novel_alipay_orders o WHERE user_id = $1 AND status = 'paid' AND membership_applied AND membership_expires_at > $2::timestamptz
      AND EXISTS (SELECT 1 FROM zook_ai_novel_alipay_orders a WHERE a.user_id = o.user_id AND a.environment = o.environment
        AND a.status = 'paid' AND a.membership_applied AND a.record->>'accountDeletedAt' IS NULL
        AND split_part(a.record->>'productKey','_',1) = split_part(o.record->>'productKey','_',1)
        AND (a.record->>'membershipStartsAt')::timestamptz <= $2::timestamptz AND a.membership_expires_at > $2::timestamptz)
      AND record->>'accountDeletedAt' IS NULL AND environment = $3
      ORDER BY split_part(record->>'productKey', '_', 1), membership_expires_at DESC`, [userId, now, billingEnvironment()]);
    return result.rows.map(row => row.record as AlipayOrder);
  }
  async save(order: AlipayOrder): Promise<void> {
    await this.query(`INSERT INTO zook_ai_novel_alipay_orders
      (order_id, app_id, user_id, idempotency_key, status, expires_at, membership_expires_at, membership_applied, environment, provider_transaction_id, record)
      VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8,$9,$10,$11::jsonb)
      ON CONFLICT (order_id) DO UPDATE SET status = EXCLUDED.status, membership_expires_at = EXCLUDED.membership_expires_at,
      membership_applied = EXCLUDED.membership_applied, provider_transaction_id = EXCLUDED.provider_transaction_id, record = EXCLUDED.record`,
    [order.orderId, order.appId, order.userId, order.idempotencyKey, order.status, order.expiresAt, order.membershipExpiresAt,
      order.membershipApplied, order.environment, order.providerTransactionId, JSON.stringify(order)]);
  }
}
