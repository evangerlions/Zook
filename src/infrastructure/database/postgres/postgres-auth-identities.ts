import type { AuthIdentityStore } from "../../../modules/auth/identity/auth-identity-store.ts";
import type { AppIdentityAccount, AppIdentityBinding, IdentityChange, IdentityKind } from "../../../modules/auth/identity/auth-identity-models.ts";

type Query = (sql: string, args: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

export class PostgresAuthIdentityStore implements AuthIdentityStore {
  constructor(private readonly query: Query) {}

  async getAccount(app: string, user: string): Promise<AppIdentityAccount | undefined> {
    const { rows } = await this.query("SELECT * FROM zook_app_auth_accounts WHERE app_id=$1 AND user_id=$2", [app, user]);
    const row = rows[0];
    return row && { appId: app, userId: user, revision: Number(row.revision), phonePromptOffered: row.phone_prompt_offered === true };
  }

  async saveAccount(account: AppIdentityAccount): Promise<void> {
    await this.query(`INSERT INTO zook_app_auth_accounts(app_id,user_id,revision,phone_prompt_offered)
      VALUES($1,$2,$3,$4) ON CONFLICT(app_id,user_id) DO UPDATE SET
      revision=EXCLUDED.revision,phone_prompt_offered=EXCLUDED.phone_prompt_offered`,
    [account.appId, account.userId, account.revision, account.phonePromptOffered]);
  }

  async findBinding(app: string, kind: IdentityKind, subject: string): Promise<AppIdentityBinding | undefined> {
    const { rows } = await this.query("SELECT * FROM zook_app_auth_identities WHERE app_id=$1 AND kind=$2 AND subject=$3", [app, kind, subject]);
    return rows[0] && this.parseBinding(rows[0]);
  }

  async listBindings(app: string, user: string): Promise<AppIdentityBinding[]> {
    const { rows } = await this.query("SELECT * FROM zook_app_auth_identities WHERE app_id=$1 AND user_id=$2 AND status='bound' ORDER BY kind", [app, user]);
    return rows.map(row => this.parseBinding(row));
  }

  async saveBinding(binding: AppIdentityBinding): Promise<void> {
    await this.query(`INSERT INTO zook_app_auth_identities(app_id,kind,subject,user_id,status,display_name)
      VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(app_id,kind,subject) DO UPDATE SET
      user_id=EXCLUDED.user_id,status=EXCLUDED.status,display_name=EXCLUDED.display_name,updated_at=NOW()`,
    [binding.appId, binding.kind, binding.subject, binding.userId, binding.status, binding.displayName ?? null]);
  }

  async getChange(id: string): Promise<IdentityChange | undefined> {
    const { rows } = await this.query("SELECT payload FROM zook_auth_identity_changes WHERE id=$1", [id]);
    return rows[0]?.payload as IdentityChange | undefined;
  }

  async saveChange(change: IdentityChange): Promise<void> {
    await this.query(`INSERT INTO zook_auth_identity_changes(id,app_id,user_id,expires_at,payload)
      VALUES($1,$2,$3,$4::timestamptz,$5::jsonb) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload`,
    [change.id, change.appId, change.userId, change.expiresAt, JSON.stringify(change)]);
  }

  async deleteChanges(appId: string, userId: string): Promise<void> {
    await this.query("DELETE FROM zook_auth_identity_changes WHERE app_id=$1 AND user_id=$2", [appId, userId]);
  }

  async deleteApp(appId: string): Promise<void> {
    for (const table of ["zook_auth_identity_changes", "zook_app_auth_identities", "zook_app_auth_accounts"])
      await this.query(`DELETE FROM ${table} WHERE app_id=$1`, [appId]);
  }

  private parseBinding(row: Record<string, unknown>): AppIdentityBinding {
    return { appId: String(row.app_id), kind: row.kind as IdentityKind, subject: String(row.subject),
      userId: String(row.user_id), status: row.status as AppIdentityBinding["status"],
      ...(row.display_name ? { displayName: String(row.display_name) } : {}) };
  }
}
