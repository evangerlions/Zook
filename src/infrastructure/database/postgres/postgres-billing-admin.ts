import type { QueryResult, QueryResultRow } from "pg";
import type { BillingRevenueRow, BillingSummaryFilter } from "../../../shared/types/billing-admin.ts";

type Query = (sql: string, values: unknown[]) => Promise<QueryResult<QueryResultRow>>;

function integer(value: unknown): number {
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new Error("Billing aggregate exceeds safe integer range");
  return result;
}

/** AINovel adapter for shared admin reporting; no payment writes or currency conversion. */
export async function queryBillingRevenue(query: Query, filter: BillingSummaryFilter): Promise<BillingRevenueRow[]> {
  const result = await query(`
    WITH events AS (
      SELECT to_char(purchased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        app_id, source, currency, 1 AS purchase_count, amount_minor AS gross_minor, 0::bigint AS refund_minor
      FROM zook_ai_novel_billing_transactions
      WHERE app_id = 'ai_novel' AND is_sandbox = $3 AND currency IS NOT NULL
        AND status NOT IN ('pending', 'closed', 'failed')
        AND purchased_at >= $1 AND purchased_at < $2 AND amount_minor > 0
      UNION ALL
      SELECT to_char(refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        app_id, source, currency, 0 AS purchase_count, 0::bigint AS gross_minor, refund_amount_minor AS refund_minor
      FROM zook_ai_novel_billing_transactions
      WHERE app_id = 'ai_novel' AND is_sandbox = $3 AND currency IS NOT NULL
        AND status NOT IN ('pending', 'closed', 'failed')
        AND refunded_at >= $1 AND refunded_at < $2 AND refund_amount_minor > 0
    )
    SELECT date, app_id, source, currency, SUM(purchase_count) AS purchase_count,
      SUM(gross_minor) AS gross_minor, SUM(refund_minor) AS refund_minor
    FROM events
    GROUP BY date, app_id, source, currency ORDER BY date DESC, app_id, source, currency`,
  [filter.from, filter.to, filter.sandbox]);
  return result.rows.map((row) => ({ date: String(row.date), appId: String(row.app_id), source: String(row.source),
    currency: String(row.currency), purchaseCount: integer(row.purchase_count),
    grossMinor: integer(row.gross_minor), refundMinor: integer(row.refund_minor) }));
}
