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
  async listAccess(userId: string, now: string): Promise<AlipayOrder[]> {
    const result = await this.query(`SELECT DISTINCT ON (split_part(record->>'productKey', '_', 1)) record
      FROM zook_ai_novel_alipay_orders WHERE user_id = $1 AND membership_applied AND membership_expires_at > $2::timestamptz
      AND record->>'accountDeletedAt' IS NULL
      ORDER BY split_part(record->>'productKey', '_', 1), membership_expires_at DESC`, [userId, now]);
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
