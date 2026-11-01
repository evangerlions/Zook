import type { Pool, PoolClient } from "pg";
import { ApplicationError } from "../../../shared/errors.ts";
import type { CreateYaoheziSelfBinding, YaoheziAccountScope, YaoheziProfileStore,
  YaoheziSelfBinding } from "../../../modules/yaohezi/profiles/yaohezi-profile-store.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function fail(status: number, code: string): never { throw new ApplicationError(status, code, "Yaohezi subject association rejected."); }
function checkScope(account: YaoheziAccountScope): void {
  if (account.appId !== "yaohezi") fail(403, "YAOHEZI_APP_SCOPE_MISMATCH");
  if (!account.userId) fail(403, "YAOHEZI_MEMBERSHIP_REQUIRED");
}
function binding(row: Record<string, unknown>): YaoheziSelfBinding {
  return { appId: "yaohezi", subjectId: String(row.subject_id), userId: String(row.user_id),
    bindingKind: "self_asserted", healthAccessEstablished: false,
    createdAt: (row.created_at as Date).toISOString() };
}

/** Own transaction per call; no request/session state is held on the singleton. */
export class PostgresYaoheziProfileStore implements YaoheziProfileStore {
  constructor(private readonly pool: Pool) {}

  private async transaction<T>(account: YaoheziAccountScope, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    checkScope(account);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Namespace the account lock. All same-account creation/replay decisions are serialized in PostgreSQL.
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`yaohezi:binding:${account.userId}`]);
      const membership = await client.query(`SELECT m.id FROM zook_app_users m
        JOIN zook_apps a ON a.id=m.app_id JOIN zook_users u ON u.id=m.user_id
        WHERE m.app_id=$1 AND m.user_id=$2 AND m.status='ACTIVE' AND a.status='ACTIVE' AND u.status='ACTIVE'
        FOR SHARE OF m,a,u`, [account.appId, account.userId]);
      if (!membership.rowCount) fail(403, "YAOHEZI_MEMBERSHIP_REQUIRED");
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async listSelfBindings(account: YaoheziAccountScope): Promise<YaoheziSelfBinding[]> {
    return this.transaction(account, async client => {
      const result = await client.query("SELECT * FROM zook_yaohezi_subject_accounts WHERE app_id=$1 AND user_id=$2", [account.appId, account.userId]);
      return result.rows.map(binding);
    });
  }

  async createSelfBinding(command: CreateYaoheziSelfBinding): Promise<YaoheziSelfBinding> {
    checkScope(command.account);
    if (command.confirmed !== true) fail(400, "YAOHEZI_EXPLICIT_CONFIRMATION_REQUIRED");
    if (!uuid.test(command.subjectId) || !uuid.test(command.operationId)) fail(400, "YAOHEZI_INVALID_ASSOCIATION_ID");
    const subjectId = command.subjectId.toLowerCase();
    return this.transaction(command.account, async client => {
      const args = [command.account.appId, command.account.userId];
      const receipt = await client.query(`SELECT subject_id FROM zook_yaohezi_binding_receipts
        WHERE app_id=$1 AND user_id=$2 AND operation_id=$3`, [...args, command.operationId]);
      if (receipt.rowCount && receipt.rows[0].subject_id !== subjectId) fail(409, "YAOHEZI_OPERATION_CONFLICT");
      const previous = await client.query("SELECT * FROM zook_yaohezi_subject_accounts WHERE app_id=$1 AND user_id=$2", args);
      if (previous.rowCount && previous.rows[0].subject_id !== subjectId) fail(409, "YAOHEZI_SELF_BINDING_EXISTS");
      if (!previous.rowCount) {
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`yaohezi:subject:${subjectId}`]);
        const subject = await client.query("SELECT 1 FROM zook_yaohezi_subjects WHERE app_id=$1 AND subject_id=$2", [command.account.appId, subjectId]);
        // An existing subject can only be linked by a future authenticated handover protocol, never by knowing its ID.
        if (subject.rowCount) fail(409, "YAOHEZI_SUBJECT_ASSOCIATION_UNAVAILABLE");
        await client.query("INSERT INTO zook_yaohezi_subjects (app_id,subject_id) VALUES ($1,$2)", [command.account.appId, subjectId]);
        await client.query(`INSERT INTO zook_yaohezi_subject_accounts (app_id,user_id,subject_id,binding_kind)
          VALUES ($1,$2,$3,'self_asserted')`, [...args, subjectId]);
      }
      await client.query(`INSERT INTO zook_yaohezi_binding_receipts (app_id,user_id,operation_id,subject_id)
        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, [...args, command.operationId, subjectId]);
      const result = await client.query("SELECT * FROM zook_yaohezi_subject_accounts WHERE app_id=$1 AND user_id=$2", args);
      return binding(result.rows[0]);
    });
  }
}
