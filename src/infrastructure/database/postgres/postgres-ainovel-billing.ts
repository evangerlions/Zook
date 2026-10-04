import type { QueryResult, QueryResultRow } from "pg";
import type {
  AiNovelBillingAdminEventFilter,
  AiNovelBillingAdminEventPage,
  AiNovelBillingAdminOrderDetailFilter,
  AiNovelBillingAdminOrderFilter,
  AiNovelBillingMembershipRecord,
  AiNovelBillingTransactionRecord,
  AiNovelBillingWebhookEventRecord,
} from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

function nullableIso(value: unknown): string | null {
  return toIsoString(value) ?? null;
}

function parseMembership(row: QueryResultRow): AiNovelBillingMembershipRecord {
  return {
    appId: "ai_novel",
    userId: String(row.user_id),
    active: Boolean(row.active),
    state: row.state as AiNovelBillingMembershipRecord["state"],
    tier: (row.tier ?? null) as AiNovelBillingMembershipRecord["tier"],
    planKey: row.plan_key == null ? null : String(row.plan_key),
    expiresAt: nullableIso(row.expires_at),
    autoRenew: row.auto_renew == null ? null : Boolean(row.auto_renew),
    source: (row.source ?? null) as AiNovelBillingMembershipRecord["source"],
    managementUrl: row.management_url == null ? null : String(row.management_url),
    lastSyncedAt: toIsoString(row.last_synced_at) as string,
    accountDeletedAt: nullableIso(row.account_deleted_at),
  };
}

function parseTransaction(row: QueryResultRow): AiNovelBillingTransactionRecord {
  return {
    appId: "ai_novel",
    userId: String(row.user_id),
    provider: "revenuecat",
    providerTransactionId: String(row.provider_transaction_id),
    productId: String(row.product_id),
    productKey: String(row.product_key),
    source: row.source as AiNovelBillingTransactionRecord["source"],
    platform: (row.platform ?? null) as AiNovelBillingTransactionRecord["platform"],
    status: row.status as AiNovelBillingTransactionRecord["status"],
    purchasedAt: nullableIso(row.purchased_at),
    originalPurchaseDate: nullableIso(row.original_purchase_date),
    expiresAt: nullableIso(row.expires_at),
    refundedAt: nullableIso(row.refunded_at),
    autoRenew: row.auto_renew == null ? null : Boolean(row.auto_renew),
    isSandbox: row.is_sandbox == null ? null : Boolean(row.is_sandbox),
    amountMinor: safeInteger(row.amount_minor),
    refundAmountMinor: safeInteger(row.refund_amount_minor),
    currency: row.currency == null ? null : String(row.currency),
    observedAt: toIsoString(row.observed_at) as string,
    accountDeletedAt: nullableIso(row.account_deleted_at),
  };
}

function safeInteger(value: unknown): number | null {
  if (value == null) return null;
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function splitPaymentId(value: string): [string, string] | undefined {
  const separator = value.indexOf(":");
  if (separator <= 0 || separator === value.length - 1) return undefined;
  return [value.slice(0, separator), value.slice(separator + 1)];
}

function parseWebhookEvent(row: QueryResultRow): AiNovelBillingWebhookEventRecord {
  return {
    appId: "ai_novel",
    eventId: String(row.event_id),
    eventType: String(row.event_type),
    userId: row.user_id == null ? null : String(row.user_id),
    affectedUserIds: Array.isArray(row.affected_user_ids)
      ? row.affected_user_ids.map(String)
      : [],
    productId: row.product_id == null ? null : String(row.product_id),
    providerTransactionId: row.provider_transaction_id == null
      ? null
      : String(row.provider_transaction_id),
    status: row.status as AiNovelBillingWebhookEventRecord["status"],
    occurredAt: nullableIso(row.occurred_at),
    processedAt: toIsoString(row.processed_at) as string,
    accountDeletedAt: nullableIso(row.account_deleted_at),
  };
}

export class PostgresAiNovelBillingStore {
  constructor(private readonly query: PostgresQuery) {}

  async findMembership(
    appId: "ai_novel",
    userId: string,
  ): Promise<AiNovelBillingMembershipRecord | undefined> {
    const result = await this.query(
      `SELECT app_id, user_id, active, state, tier, plan_key, expires_at,
              auto_renew, source, management_url, last_synced_at, account_deleted_at
       FROM zook_ai_novel_billing_memberships
       WHERE app_id = $1 AND user_id = $2`,
      [appId, userId],
    );
    return result.rows[0] ? parseMembership(result.rows[0]) : undefined;
  }

  async upsertMembership(record: AiNovelBillingMembershipRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_ai_novel_billing_memberships (
         app_id, user_id, active, state, tier, plan_key, expires_at,
         auto_renew, source, management_url, last_synced_at, account_deleted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8,$9,$10,$11::timestamptz,$12::timestamptz)
       ON CONFLICT (app_id, user_id) DO UPDATE SET
         active = EXCLUDED.active, state = EXCLUDED.state, tier = EXCLUDED.tier,
         plan_key = EXCLUDED.plan_key, expires_at = EXCLUDED.expires_at,
         auto_renew = EXCLUDED.auto_renew, source = EXCLUDED.source,
         management_url = EXCLUDED.management_url,
         last_synced_at = EXCLUDED.last_synced_at,
         account_deleted_at = EXCLUDED.account_deleted_at
       WHERE zook_ai_novel_billing_memberships.last_synced_at <= EXCLUDED.last_synced_at`,
      [record.appId, record.userId, record.active, record.state, record.tier,
        record.planKey, record.expiresAt, record.autoRenew, record.source,
        record.managementUrl, record.lastSyncedAt, record.accountDeletedAt],
    );
  }

  async upsertTransaction(record: AiNovelBillingTransactionRecord): Promise<void> {
    const isCurrentObservation =
      "zook_ai_novel_billing_transactions.observed_at <= EXCLUDED.observed_at";
    await this.query(
      `INSERT INTO zook_ai_novel_billing_transactions (
         app_id, user_id, provider, provider_transaction_id, product_id,
         product_key, source, status, purchased_at, original_purchase_date,
         expires_at, refunded_at, auto_renew, is_sandbox, platform, amount_minor,
         refund_amount_minor, currency, observed_at, account_deleted_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::timestamptz,$10::timestamptz,
                 $11::timestamptz,$12::timestamptz,$13,$14,$15,$16,$17,$18,$19::timestamptz,$20::timestamptz)
       ON CONFLICT (app_id, user_id, provider_transaction_id) DO UPDATE SET
         product_id = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.product_id ELSE zook_ai_novel_billing_transactions.product_id END,
         product_key = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.product_key ELSE zook_ai_novel_billing_transactions.product_key END,
         source = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.source ELSE zook_ai_novel_billing_transactions.source END,
         status = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.status ELSE zook_ai_novel_billing_transactions.status END,
         purchased_at = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.purchased_at ELSE zook_ai_novel_billing_transactions.purchased_at END,
         original_purchase_date = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.original_purchase_date ELSE zook_ai_novel_billing_transactions.original_purchase_date END,
         expires_at = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.expires_at ELSE zook_ai_novel_billing_transactions.expires_at END,
         refunded_at = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.refunded_at ELSE zook_ai_novel_billing_transactions.refunded_at END,
         auto_renew = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.auto_renew ELSE zook_ai_novel_billing_transactions.auto_renew END,
         is_sandbox = CASE WHEN ${isCurrentObservation} THEN EXCLUDED.is_sandbox ELSE zook_ai_novel_billing_transactions.is_sandbox END,
         platform = COALESCE(EXCLUDED.platform, zook_ai_novel_billing_transactions.platform),
         amount_minor = CASE WHEN ${isCurrentObservation} THEN COALESCE(EXCLUDED.amount_minor, zook_ai_novel_billing_transactions.amount_minor) ELSE COALESCE(zook_ai_novel_billing_transactions.amount_minor, EXCLUDED.amount_minor) END,
         refund_amount_minor = CASE WHEN ${isCurrentObservation} THEN COALESCE(EXCLUDED.refund_amount_minor, zook_ai_novel_billing_transactions.refund_amount_minor) ELSE COALESCE(zook_ai_novel_billing_transactions.refund_amount_minor, EXCLUDED.refund_amount_minor) END,
         currency = CASE WHEN ${isCurrentObservation} THEN COALESCE(EXCLUDED.currency, zook_ai_novel_billing_transactions.currency) ELSE COALESCE(zook_ai_novel_billing_transactions.currency, EXCLUDED.currency) END,
         observed_at = GREATEST(zook_ai_novel_billing_transactions.observed_at, EXCLUDED.observed_at),
         account_deleted_at = COALESCE(zook_ai_novel_billing_transactions.account_deleted_at, EXCLUDED.account_deleted_at)`,
      [record.appId, record.userId, record.provider, record.providerTransactionId,
        record.productId, record.productKey, record.source, record.status,
        record.purchasedAt, record.originalPurchaseDate, record.expiresAt,
        record.refundedAt, record.autoRenew, record.isSandbox, record.platform,
        record.amountMinor, record.refundAmountMinor, record.currency,
        record.observedAt, record.accountDeletedAt],
    );
  }

  async listTransactions(
    appId: "ai_novel",
    userId: string,
  ): Promise<AiNovelBillingTransactionRecord[]> {
    const result = await this.query(
      `SELECT app_id, user_id, provider, provider_transaction_id, product_id,
              product_key, source, status, purchased_at, original_purchase_date,
              expires_at, refunded_at, auto_renew, is_sandbox, platform, amount_minor,
              refund_amount_minor, currency, observed_at, account_deleted_at
       FROM zook_ai_novel_billing_transactions
       WHERE app_id = $1 AND user_id = $2
       ORDER BY observed_at DESC, provider_transaction_id ASC`,
      [appId, userId],
    );
    return result.rows.map(parseTransaction);
  }

  async listAdminOrders(
    filter: AiNovelBillingAdminOrderFilter,
  ): Promise<AiNovelBillingTransactionRecord[]> {
    if (filter.provider && filter.provider !== "revenuecat") return [];
    const values: unknown[] = [filter.appId];
    const clauses = ["app_id = $1"];
    const add = (clause: (placeholder: string) => string, value: unknown) => {
      values.push(value);
      clauses.push(clause(`$${values.length}`));
    };
    if (filter.userId) add((p) => `user_id = ${p}`, filter.userId);
    if (filter.providerTransactionId) add((p) => `provider_transaction_id = ${p}`, filter.providerTransactionId);
    if (filter.paymentId) {
      const parsed = splitPaymentId(filter.paymentId);
      if (!parsed) return [];
      add((p) => `user_id || ':' || provider_transaction_id = ${p}`, filter.paymentId);
    }
    if (filter.platform) add((p) => `platform = ${p}`, filter.platform);
    if (filter.distribution) add((p) => `source = ${p}`, filter.distribution === "google_play" ? "play_store" : "app_store");
    if (filter.status === "provider_paid") {
      clauses.push("status <> 'refunded' AND amount_minor > 0");
    } else if (filter.status === "unknown") {
      clauses.push("status <> 'refunded' AND (amount_minor IS NULL OR amount_minor <= 0)");
    } else if (filter.status) {
      add((p) => `status = ${p}`, filter.status);
    }
    if (filter.createdFrom) add((p) => `COALESCE(purchased_at, observed_at) >= ${p}::timestamptz`, filter.createdFrom);
    if (filter.createdTo) add((p) => `COALESCE(purchased_at, observed_at) <= ${p}::timestamptz`, filter.createdTo);
    if (filter.after) {
      values.push(filter.after.observedAt, filter.after.providerTransactionId, filter.after.userId);
      clauses.push(`(observed_at < $${values.length - 2}::timestamptz OR
        (observed_at = $${values.length - 2}::timestamptz AND
          (provider_transaction_id > $${values.length - 1} OR
            (provider_transaction_id = $${values.length - 1} AND user_id > $${values.length}))))`);
    }
    values.push(filter.limit);
    const result = await this.query(
      `SELECT app_id, user_id, provider, provider_transaction_id, product_id,
              product_key, source, status, purchased_at, original_purchase_date,
              expires_at, refunded_at, auto_renew, is_sandbox, platform, amount_minor,
              refund_amount_minor, currency, observed_at, account_deleted_at
       FROM zook_ai_novel_billing_transactions
       WHERE ${clauses.join(" AND ")}
       ORDER BY observed_at DESC, provider_transaction_id ASC, user_id ASC
       LIMIT $${values.length}`,
      values,
    );
    return result.rows.map(parseTransaction);
  }

  async findAdminOrder(
    filter: AiNovelBillingAdminOrderDetailFilter,
  ): Promise<AiNovelBillingTransactionRecord | undefined> {
    const parsed = splitPaymentId(filter.paymentId);
    if (!parsed) return undefined;
    const result = await this.query(
      `SELECT app_id, user_id, provider, provider_transaction_id, product_id,
              product_key, source, status, purchased_at, original_purchase_date,
              expires_at, refunded_at, auto_renew, is_sandbox, platform, amount_minor,
              refund_amount_minor, currency, observed_at, account_deleted_at
       FROM zook_ai_novel_billing_transactions
       WHERE app_id = $1 AND user_id = $2 AND provider_transaction_id = $3
       LIMIT 1`,
      [filter.appId, parsed[0], parsed[1]],
    );
    return result.rows[0] ? parseTransaction(result.rows[0]) : undefined;
  }

  async listAdminEvents(
    filter: AiNovelBillingAdminEventFilter,
  ): Promise<AiNovelBillingAdminEventPage> {
    const values: unknown[] = [filter.appId, filter.userId, filter.providerTransactionId];
    let afterClause = "";
    if (filter.after) {
      values.push(filter.after.processedAt, filter.after.eventId);
      afterClause = `AND (processed_at < $4::timestamptz OR
        (processed_at = $4::timestamptz AND event_id > $5))`;
    }
    values.push(filter.limit + 1);
    const result = await this.query(
      `SELECT app_id, event_id, event_type, user_id, product_id,
              provider_transaction_id, status, occurred_at, processed_at,
              account_deleted_at, affected_user_ids
       FROM zook_ai_novel_billing_webhook_events
       WHERE app_id = $1 AND (user_id = $2 OR $2 = ANY(affected_user_ids))
         AND (provider_transaction_id = $3 OR
           (event_type = 'TRANSFER' AND provider_transaction_id IS NULL)) ${afterClause}
       ORDER BY processed_at DESC, event_id ASC
       LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > filter.limit;
    const items = result.rows.slice(0, filter.limit).map(parseWebhookEvent);
    const last = items.at(-1);
    return {
      items,
      nextCursor: hasMore && last ? `${last.processedAt}|${last.eventId}` : null,
    };
  }

  async findWebhookEvent(
    appId: "ai_novel",
    eventId: string,
  ): Promise<AiNovelBillingWebhookEventRecord | undefined> {
    const result = await this.query(
      `SELECT app_id, event_id, event_type, user_id, product_id,
              provider_transaction_id, status, occurred_at, processed_at,
              account_deleted_at, affected_user_ids
       FROM zook_ai_novel_billing_webhook_events
       WHERE app_id = $1 AND event_id = $2`,
      [appId, eventId],
    );
    return result.rows[0] ? parseWebhookEvent(result.rows[0]) : undefined;
  }

  async insertWebhookEvent(record: AiNovelBillingWebhookEventRecord): Promise<boolean> {
    const result = await this.query(
      `INSERT INTO zook_ai_novel_billing_webhook_events (
         app_id, event_id, event_type, user_id, product_id,
         provider_transaction_id, status, occurred_at, processed_at,
         account_deleted_at, affected_user_ids
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::timestamptz,$9::timestamptz,$10::timestamptz,$11::text[])
       ON CONFLICT (app_id, event_id) DO NOTHING
       RETURNING event_id`,
      [record.appId, record.eventId, record.eventType, record.userId,
        record.productId, record.providerTransactionId, record.status,
        record.occurredAt, record.processedAt, record.accountDeletedAt,
        record.affectedUserIds],
    );
    return result.rowCount === 1;
  }

  async softDeleteAccount(
    appId: "ai_novel",
    userId: string,
    deletedAt: string,
  ): Promise<void> {
    await this.query(
      `UPDATE zook_ai_novel_billing_memberships
       SET active = FALSE, state = 'free', tier = NULL, plan_key = NULL,
           expires_at = NULL, auto_renew = NULL, source = NULL, management_url = NULL,
           last_synced_at = $3::timestamptz, account_deleted_at = $3::timestamptz
       WHERE app_id = $1 AND user_id = $2`,
      [appId, userId, deletedAt],
    );
    await this.query(
      `UPDATE zook_ai_novel_billing_transactions
       SET account_deleted_at = $3::timestamptz
       WHERE app_id = $1 AND user_id = $2 AND account_deleted_at IS NULL`,
      [appId, userId, deletedAt],
    );
    await this.query(
      `UPDATE zook_ai_novel_billing_webhook_events
       SET account_deleted_at = $3::timestamptz
       WHERE app_id = $1 AND
         (user_id = $2 OR $2 = ANY(affected_user_ids)) AND
         account_deleted_at IS NULL`,
      [appId, userId, deletedAt],
    );
  }
}
