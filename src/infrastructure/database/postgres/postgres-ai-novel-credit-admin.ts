import type { PoolClient } from "pg";
import { billingEnvironment } from "../../../modules/billing/billing-environment.ts";
import type { CreditGrantRecord, CreditUserCandidate, CreditUserSearchField } from "../../../modules/ai-novel/credits/admin-credit-search.ts";

export async function searchCreditUsers(client: PoolClient, field: CreditUserSearchField, term: string): Promise<CreditUserCandidate[]> {
  const column = { uid: "id", phone: "phone", email: "email" }[field];
  const result = await client.query(`SELECT id, phone, email FROM zook_users WHERE strpos(lower(coalesce(${column}, '')), lower($1)) > 0 ORDER BY id LIMIT 11`, [term]);
  return result.rows.map(row => ({ uid: row.id, phone: row.phone, email: row.email }));
}

export async function listCreditGrants(client: PoolClient, offset: number, limit: number): Promise<CreditGrantRecord[]> {
  const result = await client.query(`SELECT user_id, payload FROM zook_ai_novel_credit_events
    WHERE environment=$1 AND payload->>'kind'='grant' AND payload ? 'adminUser'
    ORDER BY occurred_at DESC, event_id DESC LIMIT $2 OFFSET $3`, [billingEnvironment(), limit, offset]);
  return result.rows.map(({ user_id, payload }) => ({
    id: payload.id, uid: user_id, points: Number(BigInt(payload.giftMicros) / 1000000n), adminUser: payload.adminUser, at: payload.at,
  }));
}
