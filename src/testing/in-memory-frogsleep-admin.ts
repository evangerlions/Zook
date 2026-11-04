import type { InMemoryDatabase } from "./in-memory-database.ts";
import { frogSleepAdminResources, type FrogSleepAdminFilter, type FrogSleepAdminResource, type FrogSleepAdminRow, type FrogSleepAdminStore } from "../modules/frogsleep/admin/frogsleep-admin.types.ts";

/** Builds the same allowlisted metadata projections as the SQL admin adapter. */
export class InMemoryFrogSleepAdminStore implements FrogSleepAdminStore {
  constructor(private readonly db: InMemoryDatabase) {}
  async summary() { return Object.fromEntries(frogSleepAdminResources.map(resource => [resource, this.rows(resource).length])); }
  async search(filter: FrogSleepAdminFilter) {
    const rows = this.rows(filter.resource).filter(row => (!filter.userId || row.user_id === filter.userId || row.partner_user_id === filter.userId) && (!filter.status || row.status === filter.status))
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at) || b.id.localeCompare(a.id));
    return { items: rows.slice((filter.page - 1) * filter.limit, filter.page * filter.limit), total: rows.length, page: filter.page, limit: filter.limit };
  }
  private rows(resource: FrogSleepAdminResource): FrogSleepAdminRow[] {
    const db = this.db;
    if (resource === "reports") return db.getPersonalSyncRepository().metadata();
    if (resource === "accounts") return db.appUsers.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.status, user_id: r.userId, domain: r.accountRegion, updated_at: r.joinedAt }));
    if (resource === "invitations") return db.frogSleepBuddyInvitationBundles.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.status, user_id: r.inviterUserId, partner_user_id: r.inviteeUserId, domain: r.domains.join(","), version: r.version, updated_at: r.updatedAt }));
    if (resource === "relationships") return db.frogSleepBuddyDomainRelationships.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.status, user_id: r.userIdLow, partner_user_id: r.userIdHigh, domain: r.domain, version: r.version, updated_at: r.updatedAt }));
    if (resource === "grants") return db.frogSleepBuddySharingGrants.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.state, user_id: r.grantorUserId, partner_user_id: r.granteeUserId, domain: `${r.domain}:${r.category}`, version: r.version, updated_at: r.updatedAt }));
    if (resource === "devices") return db.frogSleepDevices.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.deletedAt ? "deleted" : r.pushEnabled ? "enabled" : "disabled", user_id: r.userId, domain: r.platform, updated_at: r.updatedAt }));
    if (resource === "notifications") return db.notificationJobs.filter(r => r.appId === "frogsleep").map(r => ({ id: r.id, status: r.status, user_id: r.recipientUserId, domain: r.channel, attempts: r.retryCount, outcome: (r.payload._frogsleep_delivery as { outcome?: string } | undefined)?.outcome, updated_at: timestamp(r) }));
    if (resource === "email_deliveries") return db.frogSleepBuddyInvitationEmailDeliveries.filter(r => r.appId === "frogsleep").map(r => {
      const invite = db.frogSleepBuddyInvitationBundles.find(i => i.id === r.invitationId && i.appId === r.appId);
      return { id: r.id, status: r.status, user_id: invite?.inviterUserId, partner_user_id: invite?.inviteeUserId, domain: "email", attempts: r.attemptCount, outcome: r.lastErrorCode, updated_at: r.updatedAt };
    });
    const kind = { reports: "sleep_report_snapshot", sleep_sessions: "sleep_session", focus_sessions: "focus_session" }[resource];
    return db.frogSleepEntities.filter(r => r.appId === "frogsleep" && r.kind === kind && !r.deletedAt).map(r => ({ id: r.id, status: r.status ?? "active", user_id: r.ownerUserId, partner_user_id: r.partnerUserId, updated_at: r.updatedAt }));
  }
}

function timestamp(value: unknown) {
  const row=value as Record<string,unknown>;
  return String(row.updatedAt ?? row.createdAt ?? row.joinedAt ?? "");
}
