import { DEFAULT_BILLING_REVENUE_DIMENSIONS } from "../../../modules/billing/billing-revenue-dimensions.ts";
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
  const dimensions = filter.groupBy ?? DEFAULT_BILLING_REVENUE_DIMENSIONS;
  const fields = { appId: "app_id", productKey: "product_key", source: "source", market: "market" } as const;
  const selected = Object.entries(fields).map(([dimension, column]) =>
    dimensions.includes(dimension as keyof typeof fields) ? column : `NULL::text AS ${column}`);
  const grouped = dimensions.map(dimension => fields[dimension]);
  const result = await query(`
    WITH events AS (
      SELECT to_char(purchased_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        app_id, product_key, source, market, currency, 1 AS purchase_count, amount_minor AS gross_minor, 0::bigint AS refund_minor
      FROM zook_ai_novel_billing_transactions
      WHERE app_id = 'ai_novel' AND is_sandbox = $3 AND currency IS NOT NULL
        AND status NOT IN ('pending', 'closed', 'failed')
        AND purchased_at >= $1 AND purchased_at < $2 AND amount_minor > 0
      UNION ALL
      SELECT to_char(refunded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS date,
        app_id, product_key, source, market, currency, 0 AS purchase_count, 0::bigint AS gross_minor, refund_amount_minor AS refund_minor
      FROM zook_ai_novel_billing_transactions
      WHERE app_id = 'ai_novel' AND is_sandbox = $3 AND currency IS NOT NULL
        AND status NOT IN ('pending', 'closed', 'failed')
        AND refunded_at >= $1 AND refunded_at < $2 AND refund_amount_minor > 0
    )
    SELECT date, ${selected.join(", ")}, currency, SUM(purchase_count) AS purchase_count,
      SUM(gross_minor) AS gross_minor, SUM(refund_minor) AS refund_minor
    FROM events
    GROUP BY date, currency${grouped.length ? ", " + grouped.join(", ") : ""} ORDER BY date DESC, app_id, product_key, source, market, currency`,
  [filter.from, filter.to, filter.sandbox]);
  return result.rows.map((row) => ({ date: String(row.date), appId: row.app_id == null ? null : String(row.app_id), productKey: row.product_key == null ? null : String(row.product_key), source: row.source == null ? null : String(row.source),
    market: row.market == null ? null : String(row.market), currency: String(row.currency), purchaseCount: integer(row.purchase_count),
    grossMinor: integer(row.gross_minor), refundMinor: integer(row.refund_minor) }));
}
