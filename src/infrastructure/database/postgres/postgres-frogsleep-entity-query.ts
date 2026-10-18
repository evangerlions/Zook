import type { FrogSleepEntityFilter } from "../../../shared/types.ts";

// Match the millisecond precision exposed by pg/JavaScript and the existing public cursor.
const sortTime = "DATE_TRUNC('milliseconds', COALESCE(occurred_at, starts_at, created_at))";

export function buildFrogSleepEntityListQuery(filter: FrogSleepEntityFilter, table: string) {
  const values: unknown[] = [filter.appId];
  const clauses = ["app_id = $1"];
  for (const [column, value, operator] of entityPredicates(filter)) {
    if (value === undefined) continue;
    values.push(value);
    clauses.push(`${column} ${operator} $${values.length}`);
  }
  if (!filter.includeDeleted) clauses.push("deleted_at IS NULL");
  if (filter.before) {
    values.push(filter.before.t, filter.before.id);
    clauses.push(`(${sortTime}, id COLLATE "C") < ($${values.length - 1}::timestamptz, $${values.length}::text COLLATE "C")`);
  }
  values.push(Number.isFinite(filter.limit) ? Math.max(1, Math.min(Math.floor(filter.limit!), 500)) : 100);
  return { sql: `SELECT * FROM ${table} WHERE ${clauses.join(" AND ")}
    ORDER BY ${sortTime} DESC, id COLLATE "C" DESC LIMIT $${values.length}`, values };
}

function entityPredicates(filter: FrogSleepEntityFilter): Array<[string, unknown, string]> {
  return [ ["owner_user_id", filter.ownerUserId, "="], ["partner_user_id", filter.partnerUserId, "="],
    ["relationship_id", filter.relationshipId, "="], ["session_id", filter.sessionId, "="],
    ["status", filter.status, "="], ["code", filter.code, "="], ["token", filter.token, "="],
    ["starts_at", filter.startsAtFromIso, ">="], ["starts_at", filter.startsAtToIso, "<"],
    ["occurred_at", filter.occurredAtFromIso, ">="], ["occurred_at", filter.occurredAtToIso, "<"] ];
}
