import type { PoolClient } from "pg";
import { ApplicationError } from "../../../shared/errors.ts";
import type {
  UsageSource,
  UsagePayment,
} from "../../../shared/types/ai-novel-usage-admin.ts";

const MAX_ROWS = 50_000;
function bounded<T>(rows: T[]): T[] {
  if (rows.length > MAX_ROWS)
    throw new ApplicationError(
      413,
      "ADMIN_USAGE_RANGE_TOO_LARGE",
      "Too many records; select a shorter interval or an exact user ID.",
    );
  return rows;
}

/** One repeatable-read snapshot; no provider calls, balance refresh, or financial writes. */
export async function readAiNovelUsage(
  client: PoolClient,
  filter: { from: string; to: string; userId?: string },
): Promise<UsageSource> {
  const params = [filter.from, filter.to, filter.userId ?? null, MAX_ROWS + 1];
  const events = await client.query(
    `SELECT user_id,payload FROM zook_ai_novel_credit_events
    WHERE occurred_at >= $1 AND occurred_at < $2 AND ($3::text IS NULL OR user_id=$3)
    ORDER BY occurred_at,event_id LIMIT $4`,
    params,
  );
  const windows = await client.query(
    `SELECT user_id,payload FROM zook_ai_novel_credit_windows
    WHERE period_key >= $1 AND refresh_at <= $2 AND ($3::text IS NULL OR user_id=$3)
    ORDER BY period_key,user_id LIMIT $4`,
    params,
  );
  const payments = await client.query(
    `SELECT user_id, product_key, is_sandbox, currency,
    purchased_at, refunded_at, amount_minor, refund_amount_minor
    FROM zook_ai_novel_billing_transactions
    WHERE app_id='ai_novel' AND ($3::text IS NULL OR user_id=$3)
      AND status NOT IN ('pending','closed','failed') AND is_sandbox IS NOT NULL AND currency IS NOT NULL
      AND ((purchased_at >= $1 AND purchased_at < $2 AND amount_minor > 0)
        OR (refunded_at >= $1 AND refunded_at < $2 AND refund_amount_minor > 0))
    ORDER BY user_id,provider_transaction_id LIMIT $4`,
    params,
  );
  const ids = [
    ...new Set(
      [
        ...bounded(events.rows),
        ...bounded(windows.rows),
        ...bounded(payments.rows),
      ].map((row) => String(row.user_id)),
    ),
  ];
  const accounts = await client.query(
    `SELECT user_id,payload,updated_at FROM zook_ai_novel_credit_accounts
    WHERE user_id=ANY($1::text[]) OR user_id=$2 ORDER BY user_id LIMIT $3`,
    [ids, filter.userId ?? null, MAX_ROWS + 1],
  );
  const metadata = await client.query(
    "SELECT started_at FROM zook_ai_novel_credit_reporting_metadata WHERE singleton=true",
  );
  const paymentEvents: UsagePayment[] = [];
  for (const row of payments.rows) {
    const tier = /^plus_/.test(String(row.product_key))
      ? "plus"
      : /^pro_/.test(String(row.product_key))
        ? "pro"
        : "free";
    for (const kind of ["purchase", "refund"] as const) {
      const at = row[kind === "purchase" ? "purchased_at" : "refunded_at"];
      const amount =
        row[kind === "purchase" ? "amount_minor" : "refund_amount_minor"];
      if (!at || Number(amount) <= 0) continue;
      const time = new Date(at).toISOString();
      if (time < filter.from || time >= filter.to) continue;
      if (!Number.isSafeInteger(Number(amount)))
        throw new Error("Unsafe payment amount");
      paymentEvents.push({
        userId: String(row.user_id),
        at: time,
        kind,
        currency: String(row.currency),
        amountMinor: Number(amount),
        sandbox: row.is_sandbox,
        tier,
      });
    }
  }
  return {
    events: events.rows.map((row) => ({
      ...row.payload,
      userId: String(row.user_id),
    })),
    windows: windows.rows.map((row) => ({
      ...row.payload,
      userId: String(row.user_id),
    })),
    accounts: bounded(accounts.rows)
      .filter((row) => row.payload)
      .map((row) => ({
        userId: String(row.user_id),
        account: row.payload,
        observedAt: new Date(row.updated_at).toISOString(),
      })),
    payments: paymentEvents,
    reportingSince: metadata.rows[0]?.started_at
      ? new Date(metadata.rows[0].started_at).toISOString()
      : null,
  };
}
