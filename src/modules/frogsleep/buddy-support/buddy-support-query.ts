import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { badRequest } from "../../../shared/errors.ts";
import { BuddySupportAccess } from "./buddy-support-access.ts";
import { buddyRelationshipMute } from "../buddy-growth/buddy-relationship-lifecycle.service.ts";
import { appID, bounded, timestamp, unavailable } from "./buddy-support-validation.ts";
import { supportCursor, readSupportCursor } from "./buddy-support-cursor.ts";
import type { SupportDomain, SupportNote } from "./buddy-support.types.ts";

/** Provides current-authorized support capabilities, note history and merged partner cards. */
export class BuddySupportQuery {
  private readonly access: BuddySupportAccess;
  constructor(private readonly database: ApplicationDatabase) { this.access = new BuddySupportAccess(database); }
  private get store() { return this.database.getBuddySupportRepository(); }
  async capabilities(actor: string, relationship: string) {
    const row = await this.access.relationship(actor, relationship, true);
    const own = await this.store.permission(appID, relationship, actor);
    const other = await this.store.permission(appID, relationship, this.access.other(row, actor));
    const enrolled = await this.store.isEnrolled(appID, relationship);
    const active = ["accepted", "active"].includes(row.status ?? "");
    const recent = await this.store.recentSent(appID, actor, this.access.other(row, actor), new Date(Date.now() - 86400000).toISOString());
    const next = recent.length >= 3 ? new Date(new Date(recent[recent.length - 3]).getTime() + 86400000).toISOString() : null;
    return { capability: { relationship_id: relationship, domain: this.access.domain(row), enabled: enrolled,
      can_send: enrolled && active && other?.enabled === true && next === null,
      can_read_history: active && enrolled, own_receive_enabled: own?.enabled ?? false,
      permission_revision: own?.revision ?? 0, is_muted: (await buddyRelationshipMute(this.database, actor, relationship))?.payload.muted === true,
      next_send_at: next }, server_time: timestamp() };
  }
  async detail(actor: string, id: string) {
    const value = await this.store.note(appID, id);
    if (!value) unavailable();
    await this.access.readable(actor, value);
    return { note: await this.project(actor, value), server_time: timestamp() };
  }
  async operation(actor: string, id: string) {
    const value = await this.store.operation(appID, actor, id);
    return { operation: { operation_id: id, command_type: value?.command_type, state: value?.state ?? "not_found",
      resource_id: value?.resource_id ?? null }, server_time: timestamp() };
  }
  async history(actor: string, query: Record<string, unknown>) {
    const limit = bounded(query.limit, 20, 50);
    if (query.domain !== undefined && !["sleep", "focus"].includes(String(query.domain))) badRequest("REQ_INVALID_QUERY", "Invalid support domain.");
    const scope = JSON.stringify([actor, query.partner_id ?? null, query.domain ?? null]);
    const before = readSupportCursor(scope, query.cursor);
    if (before && (!before.created_at || !before.id || !Number.isFinite(Date.parse(before.created_at)))) badRequest("REQ_INVALID_QUERY", "Invalid support cursor.");
    const rows = await this.access.relationships(actor);
    const records = await this.store.notes(appID, { actor, relationships: rows.map(x => x.id), now: timestamp(), limit: limit + 1,
      partner: query.partner_id as string | undefined, domain: query.domain as SupportDomain | undefined,
      before: before as { created_at: string; id: string } | undefined });
    const page = records.slice(0, limit);
    const notes = await Promise.all(page.map(x => this.project(actor, x)));
    const last = page.at(-1);
    return { notes, next_cursor: records.length > limit && last ? supportCursor(scope, { created_at: last.created_at, id: last.id }) : null, server_time: timestamp() };
  }
  async center(actor: string, query: Record<string, unknown>) {
    if (query.include_content !== undefined && ![true, false, "true", "false"].includes(query.include_content as boolean)) badRequest("REQ_INVALID_QUERY", "Invalid include_content.");
    const limit = bounded(query.limit, 20, 20);
    const scope = JSON.stringify([actor, "center"]);
    const cursor = readSupportCursor(scope, query.cursor);
    const relationships = await this.access.relationships(actor, true);
    const groups = this.group(actor, relationships);
    const page = [...groups.keys()].sort().filter(id => !cursor || id > cursor.partner).slice(0, limit + 1);
    const active = relationships.filter(x => x.status !== "paused").map(x => x.id);
    const latest = await this.store.latestReceived(appID, actor, active, timestamp());
    const partners = await Promise.all(page.slice(0, limit).map(id => this.partner(actor, id, groups.get(id)!, latest, query.include_content !== "false" && query.include_content !== false)));
    return { enabled: true, partners, next_cursor: page.length > limit ? supportCursor(scope, { partner: page[limit - 1] }) : null, server_time: timestamp() };
  }
  private group(actor: string, relationships: FrogSleepEntityRecord[]) {
    const groups = new Map<string, FrogSleepEntityRecord[]>();
    for (const row of relationships) {
      const id = this.access.other(row, actor);
      groups.set(id, [...(groups.get(id) ?? []), row]);
    }
    return groups;
  }
  private async partner(actor: string, id: string, rows: FrogSleepEntityRecord[], latest: SupportNote[], content: boolean) {
    const identity = await this.database.findUserById(id);
    const relationships = await Promise.all(rows.map(async x => (await this.capabilities(actor, x.id)).capability));
    const value = latest.find(x => x.sender_id === id);
    return { partner_id: id, display_name: identity?.email?.split("@")[0] ?? id, relationships,
      has_note: value !== undefined, latest_received_note: content && value ? await this.project(actor, value) : null };
  }
  private async project(actor: string, value: SupportNote) {
    await this.access.readable(actor, value);
    let context = value.context;
    try { await this.access.context(actor, value.relationship_id, context); } catch { context = null; }
    const acknowledged = await this.store.acknowledged(appID, value.id);
    return { ...value, context, acknowledged, can_acknowledge: value.recipient_id === actor && !acknowledged };
  }
}
