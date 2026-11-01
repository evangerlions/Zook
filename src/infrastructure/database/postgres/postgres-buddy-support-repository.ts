import type { BuddySupportRepository, SupportNote, SupportPermission, SupportOperation, SupportNoteFilter } from "../../../modules/frogsleep/buddy-support/buddy-support.types.ts";
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: any[] }>;
const iso = (value: unknown) => new Date(value as string).toISOString();
const note = (x: any): SupportNote => ({ ...x, created_at: iso(x.created_at), expires_at: iso(x.expires_at) });

/** Persists support resources using the active database transaction connection. */
export class PostgresBuddySupportRepository implements BuddySupportRepository {
  constructor(private readonly query: Query) {}
  async isEnrolled(app: string, relationship: string) {
    return (await this.query("SELECT 1 FROM zook_frogsleep_support_policies WHERE app_id=$1 AND relationship_id=$2", [app, relationship])).rows.length > 0;
  }
  async enroll(app: string, relationship: string, now: string) {
    await this.query("INSERT INTO zook_frogsleep_support_policies(app_id,relationship_id,enrolled_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [app, relationship, now]);
  }
  async permission(app: string, relationship: string, recipient: string): Promise<SupportPermission | undefined> {
    const x = (await this.query("SELECT * FROM zook_frogsleep_support_permissions WHERE app_id=$1 AND relationship_id=$2 AND recipient_id=$3", [app, relationship, recipient])).rows[0];
    return x ? { ...x, updated_at: iso(x.updated_at) } : undefined;
  }
  async savePermission(x: SupportPermission) {
    await this.query(`INSERT INTO zook_frogsleep_support_permissions(app_id,relationship_id,recipient_id,enabled,revision,updated_at)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(app_id,relationship_id,recipient_id)
      DO UPDATE SET enabled=EXCLUDED.enabled,revision=EXCLUDED.revision,updated_at=EXCLUDED.updated_at`,
    [x.app_id, x.relationship_id, x.recipient_id, x.enabled, x.revision, x.updated_at]);
  }
  async operation(app: string, actor: string, id: string): Promise<SupportOperation | undefined> {
    const x = (await this.query("SELECT * FROM zook_frogsleep_support_operations WHERE app_id=$1 AND actor_id=$2 AND operation_id=$3", [app, actor, id])).rows[0];
    return x ? { ...x, created_at: iso(x.created_at) } : undefined;
  }
  async saveOperation(x: SupportOperation) {
    await this.query(`INSERT INTO zook_frogsleep_support_operations(app_id,actor_id,operation_id,command_type,relationship_id,request_digest,state,resource_id,result,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [x.app_id, x.actor_id, x.operation_id, x.command_type, x.relationship_id, x.request_digest, x.state, x.resource_id, x.result, x.created_at]);
  }
  async insertNote(x: SupportNote) {
    await this.query(`INSERT INTO zook_frogsleep_support_notes(app_id,id,relationship_id,domain,sender_id,recipient_id,template_key,template_version,flower,context,created_at,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [x.app_id, x.id, x.relationship_id, x.domain, x.sender_id, x.recipient_id, x.template_key, x.template_version, x.flower, x.context, x.created_at, x.expires_at]);
  }
  async note(app: string, id: string) {
    const x = (await this.query("SELECT * FROM zook_frogsleep_support_notes WHERE app_id=$1 AND id=$2", [app, id])).rows[0];
    return x ? note(x) : undefined;
  }
  async notes(app: string, f: SupportNoteFilter) {
    const result = await this.query(`SELECT * FROM zook_frogsleep_support_notes WHERE app_id=$1
      AND relationship_id=ANY($2::text[]) AND (sender_id=$3 OR recipient_id=$3) AND expires_at>$4
      AND ($5::text IS NULL OR sender_id=$5 OR recipient_id=$5) AND ($6::text IS NULL OR domain=$6)
      AND ($7::timestamptz IS NULL OR (created_at,id)<($7::timestamptz,$8::text))
      ORDER BY created_at DESC,id DESC LIMIT $9`,
    [app, f.relationships, f.actor, f.now, f.partner ?? null, f.domain ?? null, f.before?.created_at ?? null, f.before?.id ?? null, f.limit]);
    return result.rows.map(note);
  }
  async recentSent(app: string, actor: string, recipient: string, after: string) {
    const result = await this.query("SELECT created_at FROM zook_frogsleep_support_notes WHERE app_id=$1 AND sender_id=$2 AND recipient_id=$3 AND created_at>$4 ORDER BY created_at", [app, actor, recipient, after]);
    return result.rows.map(x => iso(x.created_at));
  }
  async latestReceived(app: string, actor: string, relationships: string[], now: string) {
    const result = await this.query(`SELECT DISTINCT ON(sender_id) * FROM zook_frogsleep_support_notes
      WHERE app_id=$1 AND recipient_id=$2 AND relationship_id=ANY($3::text[]) AND expires_at>$4
      ORDER BY sender_id,created_at DESC,id DESC`, [app, actor, relationships, now]);
    return result.rows.map(note);
  }
  async acknowledged(app: string, id: string) {
    return (await this.query("SELECT 1 FROM zook_frogsleep_support_acknowledgements WHERE app_id=$1 AND note_id=$2", [app, id])).rows.length > 0;
  }
  async acknowledge(app: string, id: string, recipient: string, now: string) {
    await this.query("INSERT INTO zook_frogsleep_support_acknowledgements VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [app, id, recipient, now]);
  }
  async cleanup(app: string, now: string) {
    await this.query("DELETE FROM zook_frogsleep_support_notes WHERE app_id=$1 AND id IN (SELECT id FROM zook_frogsleep_support_notes WHERE app_id=$1 AND expires_at<=$2 ORDER BY expires_at LIMIT 1000)", [app, now]);
    await this.query("DELETE FROM zook_frogsleep_support_operations WHERE ctid IN (SELECT ctid FROM zook_frogsleep_support_operations WHERE app_id=$1 AND created_at<$2::timestamptz-interval '31 days' ORDER BY created_at LIMIT 1000)", [app, now]);
  }
  async deleteUser(app: string, actor: string, relationships: string[] = []) {
    await this.query("DELETE FROM zook_frogsleep_support_notes WHERE app_id=$1 AND (sender_id=$2 OR recipient_id=$2)", [app, actor]);
    await this.query("DELETE FROM zook_frogsleep_support_operations WHERE app_id=$1 AND (actor_id=$2 OR relationship_id=ANY($3::text[]))", [app, actor, relationships]);
    await this.query("DELETE FROM zook_frogsleep_support_permissions WHERE app_id=$1 AND (recipient_id=$2 OR relationship_id=ANY($3::text[]))", [app, actor, relationships]);
    await this.query("DELETE FROM zook_frogsleep_support_policies WHERE app_id=$1 AND relationship_id=ANY($2::text[])", [app, relationships]);
  }
}
