import { randomBytes, randomUUID } from "node:crypto";
import { canonical, decode, publicRootAuthorization, reject, requireSignature, type DeviceDescriptor, type DeviceProofCommand,
  type RecoveryMaterial, type Signed } from "../../../modules/yaohezi/security/protocol.ts";
import { authority, audit, device, grant, type HealthTransaction } from "./postgres-yaohezi-health-context.ts";

export interface ChallengeRequest { subjectId: string; purpose: "bootstrap"|"enroll"|"sessions"|"recover"; device: DeviceDescriptor }
export async function issueChallenge(tx: HealthTransaction, request: ChallengeRequest) {
  decode(request.device.signingKey,32);decode(request.device.wrappingKey,32);
  if (request.purpose === "bootstrap") { if (tx.authority) reject("YAOHEZI_TRUST_ALREADY_ESTABLISHED",409); }
  else authority(tx);
  if (request.purpose === "sessions") {
    const d=await grant(tx,request.device.deviceId);
    if (d.signingKey!==request.device.signingKey || d.wrappingKey!==request.device.wrappingKey) reject("YAOHEZI_DEVICE_BINDING_MISMATCH");
  }
  const count=await tx.db.query("SELECT count(*)::int AS n FROM zook_yaohezi_health_challenges WHERE user_id=$1 AND created_at>clock_timestamp()-interval '5 minutes'",[tx.account.userId]);
  if (count.rows[0].n>=20) reject("YAOHEZI_CHALLENGE_LIMIT",429);
  const id=randomUUID(),nonce=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+300_000).toISOString();
  await tx.db.query("INSERT INTO zook_yaohezi_health_challenges(id,subject_id,user_id,purpose,descriptor,nonce,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [id,tx.subjectId,tx.account.userId,request.purpose,JSON.stringify(request.device),nonce,expiresAt]);
  return { challengeId:id,nonce,expiresAt,subjectId:tx.subjectId,userId:tx.account.userId,purpose:request.purpose,device:request.device,
    keyEpoch:tx.authority?.key_epoch ?? 1,recoveryVersion:tx.authority?.recovery_version ?? 1 };
}
export async function consumeChallenge(tx: HealthTransaction, purpose: string, proof: Signed<DeviceProofCommand>, domain=purpose): Promise<void> {
  const c=proof.command;
  if (c.accountId!==tx.account.userId) reject("YAOHEZI_TRUST_REQUIRED");
  requireSignature(domain,c,proof.signature,c.device.signingKey);
  const row=await tx.db.query(`UPDATE zook_yaohezi_health_challenges SET used=true WHERE id=$1 AND subject_id=$2 AND user_id=$3
    AND purpose=$4 AND descriptor=$5::jsonb AND nonce=$6 AND NOT used AND expires_at>clock_timestamp() RETURNING id`,
  [c.challengeId,tx.subjectId,tx.account.userId,purpose,JSON.stringify(c.device),c.challengeNonce]);
  if (!row.rowCount || c.subjectId!==tx.subjectId) reject("YAOHEZI_CHALLENGE_REJECTED",409);
}
export async function checkRecovery(tx: HealthTransaction, material: RecoveryMaterial, version: number): Promise<void> {
  decode(material.publicKey,32);decode(material.vault.nonce,12);
  if (decode(material.vault.ciphertext).length<16 || material.version!==version || material.publicKey===tx.authority?.recovery_public_key) reject("YAOHEZI_RECOVERY_MATERIAL_REJECTED",409);
  const keys=await tx.db.query("SELECT 1 FROM zook_yaohezi_health_devices WHERE signing_key=$1 OR wrapping_key=$1",[material.publicKey]);
  if (keys.rowCount) reject("YAOHEZI_RECOVERY_MATERIAL_REJECTED",409);
}
export async function addGrant(tx: HealthTransaction, descriptor: DeviceDescriptor, role: "owner"|"reader", resources: string[], authorization: unknown) {
  await device(tx,descriptor);
  const prior=await tx.db.query("SELECT 1 FROM zook_yaohezi_health_grants WHERE subject_id=$1 AND device_id=$2",[tx.subjectId,descriptor.deviceId]);
  if (prior.rowCount) reject("YAOHEZI_DEVICE_ALREADY_REGISTERED",409);
  if ((role==="owner" && resources.length!==0) || (role==="reader" && resources.length===0)) reject("YAOHEZI_INVALID_COMMAND",400);
  await tx.db.query("INSERT INTO zook_yaohezi_health_grants(subject_id,device_id,role,resources,grant_version,authorization_proof) VALUES($1,$2,$3,$4,1,$5)",
    [tx.subjectId,descriptor.deviceId,role,JSON.stringify(resources),JSON.stringify(authorization)]);
}
export async function bootstrap(tx: HealthTransaction, proof: Signed<DeviceProofCommand>) {
  if (tx.authority) reject("YAOHEZI_TRUST_ALREADY_ESTABLISHED",409);
  const c=proof.command;
  await consumeChallenge(tx,"bootstrap",proof);
  if (!c.recovery || c.recovery.publicKey===c.device.signingKey) reject("YAOHEZI_RECOVERY_MATERIAL_REJECTED",409);
  await checkRecovery(tx,c.recovery,1);
  const bindings=await tx.db.query("SELECT * FROM zook_yaohezi_subject_accounts WHERE app_id='yaohezi' AND (user_id=$1 OR subject_id=$2)",[tx.account.userId,tx.subjectId]);
  if (bindings.rows.some(r=>r.user_id!==tx.account.userId || r.subject_id!==tx.subjectId)) reject("YAOHEZI_SUBJECT_ASSOCIATION_UNAVAILABLE",409);
  await tx.db.query("INSERT INTO zook_yaohezi_subjects(app_id,subject_id) VALUES('yaohezi',$1) ON CONFLICT DO NOTHING",[tx.subjectId]);
  await tx.db.query("INSERT INTO zook_yaohezi_subject_accounts(app_id,subject_id,user_id,binding_kind) VALUES('yaohezi',$1,$2,'self_asserted') ON CONFLICT DO NOTHING",[tx.subjectId,tx.account.userId]);
  const a=await tx.db.query(`INSERT INTO zook_yaohezi_health_authorities(subject_id,owner_user_id,key_epoch,recovery_version,recovery_public_key,recovery_vault)
    VALUES($1,$2,1,1,$3,$4) RETURNING *`,[tx.subjectId,tx.account.userId,c.recovery.publicKey,JSON.stringify(c.recovery.vault)]);
  tx.authority=a.rows[0];
  await addGrant(tx,c.device,"owner",[],publicRootAuthorization("bootstrap",proof,1));
  await audit(tx,"bootstrap",c.operationId,c.device.deviceId);
  return { subjectId:tx.subjectId,deviceId:c.device.deviceId,keyEpoch:1,grantVersion:1,recoveryVersion:1 };
}
export async function rotate(tx: HealthTransaction, material: RecoveryMaterial) {
  const a=authority(tx);
  await checkRecovery(tx,material,a.recovery_version+1);
  const changed=await tx.db.query(`UPDATE zook_yaohezi_health_authorities SET key_epoch=key_epoch+1,recovery_version=recovery_version+1,
    recovery_public_key=$2,recovery_vault=$3 WHERE subject_id=$1 RETURNING *`,[tx.subjectId,material.publicKey,JSON.stringify(material.vault)]);
  tx.authority=changed.rows[0];
  await tx.db.query("UPDATE zook_yaohezi_health_sessions SET revoked=true WHERE subject_id=$1",[tx.subjectId]);
  await tx.db.query("DELETE FROM zook_yaohezi_health_capsules WHERE subject_id=$1",[tx.subjectId]);
  return { keyEpoch:authority(tx).key_epoch,recoveryVersion:authority(tx).recovery_version,futureResourceKeyRotationRequired:true };
}
export async function recover(tx: HealthTransaction, proof: Signed<DeviceProofCommand>, recoverySignature: string) {
  const a=authority(tx),c=proof.command;
  if (c.recoveryVersion!==a.recovery_version) reject("YAOHEZI_STALE_AUTHORITY",409);
  requireSignature("recover-authority",c,recoverySignature,a.recovery_public_key);
  await consumeChallenge(tx,"recover",proof);
  if (!c.recovery || c.recovery.publicKey===c.device.signingKey) reject("YAOHEZI_RECOVERY_MATERIAL_REJECTED",409);
  const result=await rotate(tx,c.recovery);
  await tx.db.query("UPDATE zook_yaohezi_health_grants SET revoked=true,grant_version=grant_version+1 WHERE subject_id=$1",[tx.subjectId]);
  await addGrant(tx,c.device,"owner",[],publicRootAuthorization("recover",{...proof,recoverySignature},authority(tx).key_epoch));
  await audit(tx,"recover",c.operationId,c.device.deviceId);
  return {...result,subjectId:tx.subjectId,deviceId:c.device.deviceId,grantVersion:1};
}
