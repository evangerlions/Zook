import type { QueryResult, QueryResultRow } from "pg";
import type { EmailDeliveryEventRecord } from "../../../shared/types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type PostgresQuery = (
  sql: string,
  values?: unknown[],
) => Promise<QueryResult<QueryResultRow>>;

function normalizeListLimit(limit?: number): number {
  return Number.isFinite(limit) ? Math.max(1, Math.min(Math.floor(limit as number), 500)) : 100;
}

function parseEmailDeliveryEvent(row: QueryResultRow): EmailDeliveryEventRecord {
  return {
    id: String(row.id),
    provider: "tencent_ses",
    event: row.event as EmailDeliveryEventRecord["event"],
    eventId: row.event_id === null || row.event_id === undefined ? undefined : Number(row.event_id),
    email: String(row.email),
    link: row.link ?? undefined,
    bulkId: row.bulk_id ?? undefined,
    timestamp: row.event_timestamp === null || row.event_timestamp === undefined ? undefined : Number(row.event_timestamp),
    reason: row.reason ?? undefined,
    bounceType: row.bounce_type ?? undefined,
    username: row.username ?? undefined,
    from: row.sender_address ?? undefined,
    fromDomain: row.from_domain ?? undefined,
    templateId: row.template_id === null || row.template_id === undefined ? undefined : Number(row.template_id),
    subject: row.subject ?? undefined,
    messageId: row.message_id ?? undefined,
    userAgent: row.user_agent ?? undefined,
    sentTimestamp: row.sent_timestamp === null || row.sent_timestamp === undefined ? undefined : Number(row.sent_timestamp),
    rawPayload: (row.raw_payload ?? {}) as Record<string, unknown>,
    occurredAt: toIsoString(row.occurred_at) as string,
    receivedAt: toIsoString(row.received_at) as string,
  };
}

export class PostgresEmailDeliveryEventStore {
  constructor(private readonly query: PostgresQuery) {}

  async insert(record: EmailDeliveryEventRecord): Promise<void> {
    await this.query(
      `INSERT INTO zook_email_delivery_events (
         id, provider, event, event_id, email, link, bulk_id, event_timestamp,
         reason, bounce_type, username, sender_address, from_domain,
         template_id, subject, message_id, user_agent, sent_timestamp,
         raw_payload, occurred_at, received_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18,
         $19::jsonb, $20::timestamptz, $21::timestamptz
       )`,
      [
        record.id,
        record.provider,
        record.event,
        record.eventId ?? null,
        record.email,
        record.link ?? null,
        record.bulkId ?? null,
        record.timestamp ?? null,
        record.reason ?? null,
        record.bounceType ?? null,
        record.username ?? null,
        record.from ?? null,
        record.fromDomain ?? null,
        record.templateId ?? null,
        record.subject ?? null,
        record.messageId ?? null,
        record.userAgent ?? null,
        record.sentTimestamp ?? null,
        JSON.stringify(record.rawPayload),
        record.occurredAt,
        record.receivedAt,
      ],
    );
  }

  async list(filter: {
    event?: EmailDeliveryEventRecord["event"];
    email?: string;
    limit?: number;
  } = {}): Promise<EmailDeliveryEventRecord[]> {
    const clauses: string[] = [];
    const values: unknown[] = [];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      clauses.push(clause.replace("?", `$${values.length}`));
    };
    if (filter.event) add("event = ?", filter.event);
    if (filter.email?.trim()) add("lower(email) LIKE lower(?)", `%${filter.email.trim()}%`);
    const limit = normalizeListLimit(filter.limit);
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await this.query(
      `SELECT id, provider, event, event_id, email, link, bulk_id,
              event_timestamp, reason, bounce_type, username, sender_address,
              from_domain, template_id, subject, message_id, user_agent,
              sent_timestamp, raw_payload, occurred_at, received_at
       FROM zook_email_delivery_events
       ${where}
       ORDER BY received_at DESC
       LIMIT ${limit}`,
      values,
    );
    return result.rows.map(parseEmailDeliveryEvent);
  }
}
