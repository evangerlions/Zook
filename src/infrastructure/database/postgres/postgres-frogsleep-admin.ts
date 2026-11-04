import type { QueryResultRow } from "pg";
import type { FrogSleepAdminFilter, FrogSleepAdminRow, FrogSleepAdminStore } from "../../../modules/frogsleep/admin/frogsleep-admin.types.ts";
import { toIsoString } from "./postgres-row-utils.ts";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: QueryResultRow[] }>;
const sources = {
  accounts: "SELECT id, app_id, status, user_id, NULL::text partner_user_id, account_region::text domain, NULL::int version, NULL::int attempts, NULL::text outcome, COALESCE(updated_at,joined_at) updated_at FROM zook_app_users",
  invitations: "SELECT id, app_id, status, inviter_user_id user_id, invitee_user_id partner_user_id, array_to_string(domains,',') domain, version, NULL::int attempts, NULL::text outcome, updated_at FROM zook_frogsleep_buddy_invitation_bundles",
  relationships: "SELECT id, app_id, status, user_id_low user_id, user_id_high partner_user_id, domain, version, NULL::int attempts, NULL::text outcome, updated_at FROM zook_frogsleep_buddy_domain_relationships",
  grants: "SELECT id, app_id, state status, grantor_user_id user_id, grantee_user_id partner_user_id, domain || ':' || category domain, version, NULL::int attempts, NULL::text outcome, updated_at FROM zook_frogsleep_buddy_sharing_grants",
  sleep_sessions: entitySource("zook_frogsleep_sleep_sessions"),
  focus_sessions: entitySource("zook_frogsleep_focus_sessions"),
  reports: "SELECT resource_id id, app_id, CASE WHEN (document->>'deleted')::boolean THEN 'deleted' ELSE 'active' END status,user_id,NULL::text partner_user_id,'sleep_report'::text domain,(document->>'revision')::int version,NULL::int attempts,NULL::text outcome,(document->>'updated_at')::timestamptz updated_at FROM (SELECT DISTINCT ON(app_id,user_id,kind,resource_id) * FROM zook_frogsleep_personal_versions WHERE kind='sleep_report' ORDER BY app_id,user_id,kind,resource_id,sequence DESC) v",
  devices: "SELECT id, app_id, CASE WHEN deleted_at IS NOT NULL THEN 'deleted' WHEN push_enabled THEN 'enabled' ELSE 'disabled' END status, user_id, NULL::text partner_user_id, platform domain, NULL::int version, NULL::int attempts, NULL::text outcome, updated_at FROM zook_frogsleep_devices",
  notifications: "SELECT id, app_id, status, recipient_user_id user_id, NULL::text partner_user_id, channel domain, NULL::int version, retry_count attempts, payload #>> '{_frogsleep_delivery,outcome}' outcome, updated_at FROM zook_notification_jobs",
  email_deliveries: "SELECT d.id, d.app_id, d.status, i.inviter_user_id user_id, i.invitee_user_id partner_user_id, 'email'::text domain, NULL::int version, d.attempt_count attempts, d.last_error_code outcome, d.updated_at FROM zook_frogsleep_buddy_invitation_email_deliveries d JOIN zook_frogsleep_buddy_invitation_bundles i ON i.app_id=d.app_id AND i.id=d.invitation_id",
};
function entitySource(table: string) {
  return `SELECT id, app_id, COALESCE(status,'active') status, owner_user_id user_id, partner_user_id, NULL::text domain, NULL::int version, NULL::int attempts, NULL::text outcome, updated_at FROM ${table} WHERE deleted_at IS NULL`;
}
/** Executes fixed-scope aggregates and database pagination without exposing product payloads. */
export class PostgresFrogSleepAdminStore implements FrogSleepAdminStore {
  constructor(private readonly query: Query) {}
  async summary() {
    const sql = Object.entries(sources).map(([key, source]) => `SELECT '${key}' key, count(*)::int n FROM (${source}) s WHERE app_id='frogsleep'`).join(" UNION ALL ");
    const { rows } = await this.query(sql);
    return Object.fromEntries(rows.map(row => [String(row.key), Number(row.n)]));
  }
  async search(filter: FrogSleepAdminFilter) {
    const values: unknown[] = ["frogsleep"];
    const clauses = ["app_id=$1"];
    if (filter.userId) { values.push(filter.userId); clauses.push(`(user_id=$${values.length} OR partner_user_id=$${values.length})`); }
    if (filter.status) { values.push(filter.status); clauses.push(`status=$${values.length}`); }
    const relation = `(${sources[filter.resource]}) s WHERE ${clauses.join(" AND ")}`;
    const total = Number((await this.query(`SELECT count(*)::int n FROM ${relation}`, values)).rows[0].n);
    values.push(filter.limit, (filter.page - 1) * filter.limit);
    const { rows } = await this.query(`SELECT id,status,user_id,partner_user_id,domain,version,attempts,outcome,updated_at FROM ${relation} ORDER BY updated_at DESC,id DESC LIMIT $${values.length - 1} OFFSET $${values.length}`, values);
    return { items: rows.map(row => ({ ...row, updated_at: toIsoString(row.updated_at) } as FrogSleepAdminRow)), total, page: filter.page, limit: filter.limit };
  }
}
