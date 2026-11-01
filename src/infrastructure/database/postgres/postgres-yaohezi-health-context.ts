import type { Pool, PoolClient } from "pg";
import type { YaoheziAccountScope } from "../../../modules/yaohezi/profiles/yaohezi-profile-store.ts";
import { canonical, digest, reject, requireSignature, type DeviceDescriptor, type DeviceGrant, type ManagementCommand,
  type RecoveryMaterial, type Signed } from "../../../modules/yaohezi/security/protocol.ts";

export interface Authority { subject_id: string; owner_user_id: string; key_epoch: number; recovery_version: number;
  recovery_public_key: string; recovery_vault: RecoveryMaterial["vault"] }
export interface GrantRow extends DeviceDescriptor { userId: string; role: DeviceGrant["role"]; resources: string[]; grantVersion: number; revoked: boolean }
export interface HealthTransaction { db: PoolClient; account: YaoheziAccountScope; subjectId: string; authority?: Authority }
export async function transaction<T>(pool: Pool, account: YaoheziAccountScope, subjectId: string,
  operation: (tx: HealthTransaction) => Promise<T>): Promise<T> {
  if (account.appId !== "yaohezi") reject("YAOHEZI_APP_SCOPE_MISMATCH");
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    // Same account/subject locks as explicit binding creation. Every trust/protected operation uses this order.
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`yaohezi:binding:${account.userId}`]);
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`yaohezi:subject:${subjectId}`]);
    const active = await db.query(`SELECT m.id FROM zook_app_users m JOIN zook_apps a ON a.id=m.app_id
      JOIN zook_users u ON u.id=m.user_id WHERE m.app_id='yaohezi' AND m.user_id=$1 AND m.status='ACTIVE'
      AND a.status='ACTIVE' AND u.status='ACTIVE' FOR SHARE OF m,a,u`, [account.userId]);
    if (!active.rowCount) reject("YAOHEZI_MEMBERSHIP_REQUIRED");
    const row = await db.query<Authority>("SELECT * FROM zook_yaohezi_health_authorities WHERE subject_id=$1 FOR UPDATE", [subjectId]);
    const result = await operation({ db, account, subjectId, authority: row.rows[0] });
    await db.query("COMMIT"); return result;
  } catch (error) { await db.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { db.release(); }
}
export function authority(tx: HealthTransaction): Authority {
  if (!tx.authority || tx.authority.owner_user_id !== tx.account.userId) reject("YAOHEZI_TRUST_REQUIRED");
  return tx.authority;
}
export async function grant(tx: HealthTransaction, deviceId: string): Promise<GrantRow> {
  const row = await tx.db.query(`SELECT d.*,g.role,g.resources,g.grant_version,g.revoked FROM zook_yaohezi_health_devices d
    JOIN zook_yaohezi_health_grants g USING(device_id) WHERE g.subject_id=$1 AND d.device_id=$2 AND d.user_id=$3`,
  [tx.subjectId, deviceId, tx.account.userId]);
  const value = row.rows[0];
  if (!value || value.revoked) reject("YAOHEZI_TRUST_REQUIRED");
  return { deviceId: value.device_id, signingKey: value.signing_key, wrappingKey: value.wrapping_key,
    userId: value.user_id, role: value.role, resources: value.resources, grantVersion: value.grant_version, revoked: value.revoked };
}
export async function device(tx: HealthTransaction, descriptor: DeviceDescriptor): Promise<void> {
  const row = await tx.db.query("SELECT * FROM zook_yaohezi_health_devices WHERE device_id=$1", [descriptor.deviceId]);
  if (row.rowCount) {
    const d = row.rows[0];
    if (d.user_id !== tx.account.userId || d.signing_key !== descriptor.signingKey || d.wrapping_key !== descriptor.wrappingKey) reject("YAOHEZI_DEVICE_BINDING_MISMATCH");
  } else {
    const duplicate = await tx.db.query("SELECT 1 FROM zook_yaohezi_health_devices WHERE signing_key=$1 OR wrapping_key=$2", [descriptor.signingKey, descriptor.wrappingKey]);
    if (duplicate.rowCount) reject("YAOHEZI_DEVICE_BINDING_MISMATCH");
    await tx.db.query("INSERT INTO zook_yaohezi_health_devices(device_id,user_id,signing_key,wrapping_key) VALUES($1,$2,$3,$4)",
      [descriptor.deviceId,tx.account.userId,descriptor.signingKey,descriptor.wrappingKey]);
  }
}
export async function authorized(tx: HealthTransaction, action: string, proof: Signed<ManagementCommand>, token?: string): Promise<GrantRow> {
  const a = authority(tx), c = proof.command;
  if (c.actorAccountId !== tx.account.userId) reject("YAOHEZI_TRUST_REQUIRED");
  const g = await grant(tx,c.actorDeviceId);
  requireSignature(action,c,proof.signature,g.signingKey);
  if (c.subjectId !== tx.subjectId || c.keyEpoch !== a.key_epoch || c.grantVersion !== g.grantVersion) reject("YAOHEZI_STALE_AUTHORITY",409);
  if (c.expiresAt <= Date.now() || c.expiresAt > Date.now()+300_000) reject("YAOHEZI_PROOF_EXPIRED");
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) reject("YAOHEZI_HEALTH_SESSION_REQUIRED");
  const s = await tx.db.query(`SELECT 1 FROM zook_yaohezi_health_sessions WHERE token_hash=$1 AND subject_id=$2 AND device_id=$3
    AND user_id=$4 AND grant_version=$5 AND key_epoch=$6 AND NOT revoked AND expires_at>clock_timestamp()`,
  [digest(token),tx.subjectId,g.deviceId,tx.account.userId,g.grantVersion,a.key_epoch]);
  if (!s.rowCount) reject("YAOHEZI_HEALTH_SESSION_REQUIRED");
  return g;
}
export function owner(g: GrantRow): void { if (g.role !== "owner") reject("YAOHEZI_ACTION_DENIED"); }
export async function audit(tx: HealthTransaction, action: string, operationId: string, deviceId: string): Promise<void> {
  await tx.db.query("INSERT INTO zook_yaohezi_health_audit(subject_id,user_id,device_id,action,operation_id,key_epoch) VALUES($1,$2,$3,$4,$5,$6)",
    [tx.subjectId,tx.account.userId,deviceId,action,operationId,authority(tx).key_epoch]);
}
export async function receipt(tx: HealthTransaction, action: string, proof: Signed<ManagementCommand>): Promise<unknown | undefined> {
  const row = await tx.db.query("SELECT * FROM zook_yaohezi_health_receipts WHERE subject_id=$1 AND operation_id=$2", [tx.subjectId,proof.command.operationId]);
  if (!row.rowCount) return undefined;
  const r=row.rows[0];
  if (r.action!==action || r.device_id!==proof.command.actorDeviceId || r.command_hash!==digest(canonical(proof))) reject("YAOHEZI_OPERATION_CONFLICT",409);
  return r.result;
}
export async function record(tx: HealthTransaction, action: string, proof: Signed<ManagementCommand>, result: unknown): Promise<unknown> {
  await tx.db.query("INSERT INTO zook_yaohezi_health_receipts(subject_id,operation_id,device_id,command_hash,action,result) VALUES($1,$2,$3,$4,$5,$6)",
    [tx.subjectId,proof.command.operationId,proof.command.actorDeviceId,digest(canonical(proof)),action,JSON.stringify(result)]);
  await audit(tx,action,proof.command.operationId,proof.command.actorDeviceId);return result;
}
