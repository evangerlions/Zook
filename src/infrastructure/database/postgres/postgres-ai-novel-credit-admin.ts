import type { PoolClient } from "pg";
import { billingEnvironment } from "../../../modules/billing/billing-environment.ts";
import type { CreditGrantRecord, CreditUserCandidate, CreditUserSearchField } from "../../../modules/ai-novel/credits/admin-credit-search.ts";

export async function searchCreditUsers(client: PoolClient, field: CreditUserSearchField, term: string): Promise<CreditUserCandidate[]> {
  const column = { uid: "id", phone: "phone", email: "email" }[field];
  const result = await client.query(`SELECT id, phone, email FROM zook_users WHERE strpos(lower(coalesce(${column}, '')), lower($1)) > 0 ORDER BY id LIMIT 11`, [term]);
  return result.rows.map(row => ({ uid: row.id, phone: row.phone, email: row.email }));
}

export async function listCreditGrants(client: PoolClient, offset: number, limit: number): Promise<CreditGrantRecord[]> {
  const result = await client.query(`SELECT e.user_id, e.payload, u.id AS current_user_id, u.phone AS current_phone, u.email AS current_email FROM zook_ai_novel_credit_events e
    LEFT JOIN zook_users u ON u.id = e.user_id
    WHERE e.environment=$1 AND e.payload->>'kind'='grant' AND e.payload ? 'adminUser'
    ORDER BY e.occurred_at DESC, e.event_id DESC LIMIT $2 OFFSET $3`, [billingEnvironment(), limit, offset]);
  return result.rows.map<CreditGrantRecord>(({ user_id, payload, current_user_id, current_phone, current_email }) => ({
    id: payload.id, uid: user_id, points: Number(BigInt(payload.giftMicros) / 1000000n), adminUser: payload.adminUser, at: payload.at,
    phone: payload.recipientContact ? payload.recipientContact.phone : current_phone ?? null,
    email: payload.recipientContact ? payload.recipientContact.email : current_email ?? null,
    contactSource: payload.recipientContact ? "snapshot" : current_user_id ? "current" : "unavailable",
  }));
}
