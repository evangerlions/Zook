import type { BuddySupportRepository, SupportNote, SupportPermission, SupportOperation, SupportNoteFilter } from "../modules/frogsleep/buddy-support/buddy-support.types.ts";

export interface SupportMemoryState {
  supportNotes: SupportNote[]; supportPermissions: SupportPermission[]; supportOperations: SupportOperation[];
  supportPolicies: { app: string; relationship: string }[];
  supportAcks: { app: string; id: string; recipient: string }[];
}
/** Test adapter whose collections participate in the database transaction snapshot. */
export class InMemoryBuddySupportRepository implements BuddySupportRepository {
  constructor(private readonly state: SupportMemoryState) {}
  async isEnrolled(app: string, relationship: string) {
    return this.state.supportPolicies.some(x => x.app === app && x.relationship === relationship);
  }
  async enroll(app: string, relationship: string, _now: string) {
    if (!await this.isEnrolled(app, relationship)) this.state.supportPolicies.push({ app, relationship });
  }
  async permission(app: string, relationship: string, recipient: string) {
    return structuredClone(this.state.supportPermissions.find(x => x.app_id === app && x.relationship_id === relationship && x.recipient_id === recipient));
  }
  async savePermission(value: SupportPermission) {
    this.state.supportPermissions = this.state.supportPermissions.filter(x => !(x.app_id === value.app_id && x.relationship_id === value.relationship_id && x.recipient_id === value.recipient_id));
    this.state.supportPermissions.push(structuredClone(value));
  }
  async operation(app: string, actor: string, id: string) {
    return structuredClone(this.state.supportOperations.find(x => x.app_id === app && x.actor_id === actor && x.operation_id === id));
  }
  async saveOperation(value: SupportOperation) {
    if (await this.operation(value.app_id, value.actor_id, value.operation_id)) throw new Error("Operation conflict");
    this.state.supportOperations.push(structuredClone(value));
  }
  async insertNote(value: SupportNote) { this.state.supportNotes.push(structuredClone(value)); }
  async note(app: string, id: string) { return structuredClone(this.state.supportNotes.find(x => x.app_id === app && x.id === id)); }
  async notes(app: string, f: SupportNoteFilter) {
    return structuredClone(this.state.supportNotes.filter(x => x.app_id === app && f.relationships.includes(x.relationship_id)
      && [x.sender_id, x.recipient_id].includes(f.actor) && x.expires_at > f.now
      && (!f.partner || [x.sender_id, x.recipient_id].includes(f.partner)) && (!f.domain || x.domain === f.domain)
      && (!f.before || x.created_at < f.before.created_at || (x.created_at === f.before.created_at && x.id < f.before.id)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, f.limit));
  }
  async recentSent(app: string, actor: string, recipient: string, after: string) {
    return this.state.supportNotes.filter(x => x.app_id === app && x.sender_id === actor && x.recipient_id === recipient && x.created_at > after)
      .map(x => x.created_at).sort();
  }
  async latestReceived(app: string, actor: string, relationships: string[], now: string) {
    const records = await this.notes(app, { actor, relationships, limit: Number.MAX_SAFE_INTEGER, now });
    const latest = new Map<string, SupportNote>();
    for (const x of records) if (x.recipient_id === actor && !latest.has(x.sender_id)) latest.set(x.sender_id, x);
    return [...latest.values()];
  }
  async acknowledged(app: string, id: string) { return this.state.supportAcks.some(x => x.app === app && x.id === id); }
  async acknowledge(app: string, id: string, recipient: string, _now: string) {
    if (!await this.acknowledged(app, id)) this.state.supportAcks.push({ app, id, recipient });
  }
  async cleanup(app: string, now: string) {
    const expired = this.state.supportNotes.filter(x => x.app_id === app && x.expires_at <= now).map(x => x.id);
    this.state.supportNotes = this.state.supportNotes.filter(x => !(x.app_id === app && expired.includes(x.id)));
    this.state.supportAcks = this.state.supportAcks.filter(x => !(x.app === app && expired.includes(x.id)));
    const cutoff = new Date(new Date(now).getTime() - 31 * 86400000).toISOString();
    this.state.supportOperations = this.state.supportOperations.filter(x => x.app_id !== app || x.created_at > cutoff);
  }
  async deleteUser(app: string, actor: string, relationships: string[] = []) { this.deleteUserSync(app, actor, relationships); }
  deleteUserSync(app: string, actor: string, relationships: string[] = []) {
    const ids = this.state.supportNotes.filter(x => x.app_id === app && [x.sender_id, x.recipient_id].includes(actor)).map(x => x.id);
    this.state.supportNotes = this.state.supportNotes.filter(x => !(x.app_id === app && ids.includes(x.id)));
    this.state.supportAcks = this.state.supportAcks.filter(x => !(x.app === app && ids.includes(x.id)));
    this.state.supportOperations = this.state.supportOperations.filter(x => !(x.app_id === app && (x.actor_id === actor || relationships.includes(x.relationship_id))));
    this.state.supportPermissions = this.state.supportPermissions.filter(x => !(x.app_id === app && (x.recipient_id === actor || relationships.includes(x.relationship_id))));
    this.state.supportPolicies = this.state.supportPolicies.filter(x => !(x.app === app && relationships.includes(x.relationship)));
  }
}
