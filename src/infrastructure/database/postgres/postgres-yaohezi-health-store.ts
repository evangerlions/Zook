import { randomBytes } from "node:crypto";
import type { Pool } from "pg";
import type { YaoheziAccountScope } from "../../../modules/yaohezi/profiles/yaohezi-profile-store.ts";
import type { YaoheziHealthStore } from "../../../modules/yaohezi/security/health-store.ts";
import { validateHealthRequest } from "../../../modules/yaohezi/security/validation.ts";
import { canonical, decode, digest, inScope, reject, requireSignature, type DeviceProofCommand, type EnrollCommand,
  type KeyCapsule, type ManagementCommand, type RecoveryMaterial, type RevisionEnvelope, type Signed } from "../../../modules/yaohezi/security/protocol.ts";
import { authority, audit, authorized, grant, owner, receipt, record, transaction, type GrantRow, type HealthTransaction } from "./postgres-yaohezi-health-context.ts";
import { addGrant, bootstrap, consumeChallenge, issueChallenge, recover, rotate, type ChallengeRequest } from "./postgres-yaohezi-health-trust.ts";

export class PostgresYaoheziHealthStore implements YaoheziHealthStore {
  constructor(private readonly pool: Pool) {}
  async handle(action: string, account: YaoheziAccountScope, body: unknown, sessionToken?: string): Promise<unknown> {
    validateHealthRequest(action,body);
    const subjectId=(action==="challenges" || action==="recovery") ? (body as {subjectId:string}).subjectId : (body as Signed<ManagementCommand>).command.subjectId;
    return transaction(this.pool,account,subjectId,async tx=>{
      if (action==="challenges") return issueChallenge(tx,body as ChallengeRequest);
      if (action==="recovery") { const a=authority(tx);return {subjectId,recovery:{version:a.recovery_version,publicKey:a.recovery_public_key,vault:a.recovery_vault},keyEpoch:a.key_epoch}; }
      if (action==="bootstrap") return bootstrap(tx,body as Signed<DeviceProofCommand>);
      if (action==="recover") return recover(tx,body as Signed<DeviceProofCommand>,(body as {recoverySignature:string}).recoverySignature);
      if (action==="sessions") return this.session(tx,body as Signed<DeviceProofCommand>);
      const proof=body as Signed<ManagementCommand>;
      const actor=await authorized(tx,action,proof,sessionToken);
      // Current authorization is always checked BEFORE receipt replay.
      const previous=await receipt(tx,action,proof);if (previous!==undefined) return previous;
      const result=await this.protected(tx,action,proof,actor,sessionToken!);
      return record(tx,action,proof,result);
    });
  }
  private async session(tx: HealthTransaction, proof: Signed<DeviceProofCommand>) {
    const a=authority(tx),c=proof.command,g=await grant(tx,c.device.deviceId);
    if (g.signingKey!==c.device.signingKey || g.wrappingKey!==c.device.wrappingKey) reject("YAOHEZI_DEVICE_BINDING_MISMATCH");
    await consumeChallenge(tx,"sessions",proof);
    const token=randomBytes(32).toString("base64url"),expiresAt=new Date(Date.now()+900_000).toISOString();
    await tx.db.query(`INSERT INTO zook_yaohezi_health_sessions(token_hash,subject_id,device_id,user_id,grant_version,key_epoch,expires_at)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[digest(token),tx.subjectId,g.deviceId,tx.account.userId,g.grantVersion,a.key_epoch,expiresAt]);
    await audit(tx,"sessions",c.operationId,g.deviceId);
    return {sessionToken:token,expiresAt,subjectId:tx.subjectId,deviceId:g.deviceId,keyEpoch:a.key_epoch,grantVersion:g.grantVersion,role:g.role,resources:g.resources};
  }
  private async protected(tx: HealthTransaction, action: string, proof: Signed<ManagementCommand>, actor: GrantRow, sessionToken:string): Promise<unknown> {
    const c=proof.command,a=authority(tx);
    switch (action) {
      case "logout":
        await tx.db.query("UPDATE zook_yaohezi_health_sessions SET revoked=true WHERE token_hash=$1",[digest(sessionToken)]);
        return {revoked:true,deviceId:actor.deviceId};
      case "inspect": {
        const rows=await tx.db.query(`WITH RECURSIVE lineage(device_id) AS (
          SELECT device_id FROM zook_yaohezi_health_grants WHERE subject_id=$1 AND (device_id=$3 OR (role='owner' AND NOT revoked))
          UNION SELECT (g.authorization_proof#>>'{command,actorDeviceId}')::uuid
          FROM zook_yaohezi_health_grants g JOIN lineage l USING(device_id)
          WHERE g.subject_id=$1 AND g.authorization_proof#>>'{command,actorDeviceId}' IS NOT NULL)
          SELECT d.device_id,d.user_id,d.signing_key,d.wrapping_key,g.role,g.resources,g.grant_version,g.revoked,g.authorization_proof
          FROM zook_yaohezi_health_devices d JOIN zook_yaohezi_health_grants g USING(device_id)
          WHERE g.subject_id=$1 AND ($2::boolean OR d.device_id IN (SELECT device_id FROM lineage)) ORDER BY d.device_id`,[tx.subjectId,actor.role==="owner",actor.deviceId]);
        const caps=await tx.db.query("SELECT capsule FROM zook_yaohezi_health_capsules WHERE subject_id=$1 AND device_id=$2 AND key_epoch=$3 AND grant_version=$4",[tx.subjectId,actor.deviceId,a.key_epoch,actor.grantVersion]);
        const issuedAt=Date.now();
        return {subjectId:tx.subjectId,accountId:tx.account.userId,snapshotNonce:c.operationId,issuedAt,validUntil:issuedAt+30_000,keyEpoch:a.key_epoch,grantVersion:actor.grantVersion,recoveryVersion:a.recovery_version,devices:rows.rows.map(r=>({device:{deviceId:r.device_id,signingKey:r.signing_key,wrappingKey:r.wrapping_key},accountId:r.user_id,
          role:r.role,resources:r.resources,grantVersion:r.grant_version,revoked:r.revoked,authorization:r.authorization_proof})),capsules:caps.rows.map(r=>r.capsule)};
      }
      case "enroll": {
        owner(actor);const e=c as EnrollCommand;
        await consumeChallenge(tx,"enroll",e.candidate,"enroll-proof");
        if (e.candidate.command.subjectId!==tx.subjectId) reject("YAOHEZI_TRUST_REQUIRED");
        const count=await tx.db.query("SELECT count(*)::int AS n FROM zook_yaohezi_health_grants WHERE subject_id=$1 AND NOT revoked",[tx.subjectId]);
        if (count.rows[0].n>=20) reject("YAOHEZI_DEVICE_LIMIT",409);
        await addGrant(tx,e.candidate.command.device,e.role,e.resources,proof);
        return {subjectId:tx.subjectId,deviceId:e.candidate.command.device.deviceId,keyEpoch:a.key_epoch,grantVersion:1,role:e.role,resources:e.resources,authorization:proof};
      }
      case "revoke-device": {
        owner(actor);const r=c as ManagementCommand & {targetDeviceId:string;recovery:RecoveryMaterial};
        await grant(tx,r.targetDeviceId);
        const result=await rotate(tx,r.recovery);
        await tx.db.query("UPDATE zook_yaohezi_health_grants SET revoked=true,grant_version=grant_version+1 WHERE subject_id=$1 AND device_id=$2",[tx.subjectId,r.targetDeviceId]);
        return {...result,revoked:true,deviceId:r.targetDeviceId};
      }
      case "rotate-keys":
        owner(actor);return rotate(tx,(c as ManagementCommand & {recovery:RecoveryMaterial}).recovery);
      case "key-capsules":
        owner(actor);return this.capsules(tx,actor,(c as ManagementCommand & {capsules:KeyCapsule[]}).capsules);
      case "verify-operation":
        return this.verifyOperation(tx,actor,(c as ManagementCommand & {revision:Signed<RevisionEnvelope>}).revision);
      default:return reject("YAOHEZI_ROUTE_NOT_FOUND",404);
    }
  }
  private async capsules(tx:HealthTransaction,actor:GrantRow,capsules:KeyCapsule[]) {
    for (const capsule of capsules) {
      const k=capsule.context,recipient=await grant(tx,k.recipientDeviceId);
      if (k.subjectId!==tx.subjectId || k.keyEpoch!==authority(tx).key_epoch || k.grantVersion!==recipient.grantVersion
        || k.recipientAccountId!==recipient.userId || k.recipientWrappingKey!==recipient.wrappingKey
        || k.senderAccountId!==tx.account.userId || k.senderDeviceId!==actor.deviceId || !inScope(recipient,k.resourceId)) reject("YAOHEZI_KEY_SCOPE_DENIED");
      decode(capsule.enc,32);decode(capsule.ciphertext,48);
      requireSignature("key-capsule",{context:k,enc:capsule.enc,ciphertext:capsule.ciphertext},capsule.signature,actor.signingKey);
      const prior=await tx.db.query("SELECT capsule FROM zook_yaohezi_health_capsules WHERE subject_id=$1 AND device_id=$2 AND resource_id=$3 AND resource_version=$4",[tx.subjectId,recipient.deviceId,k.resourceId,k.resourceVersion]);
      if (prior.rowCount && canonical(prior.rows[0].capsule)!==canonical(capsule)) reject("YAOHEZI_KEY_CAPSULE_CONFLICT",409);
      await tx.db.query(`INSERT INTO zook_yaohezi_health_capsules(subject_id,device_id,resource_id,resource_version,key_epoch,grant_version,capsule)
        VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,[tx.subjectId,recipient.deviceId,k.resourceId,k.resourceVersion,k.keyEpoch,k.grantVersion,JSON.stringify(capsule)]);
    }
    return {stored:capsules.length,keyEpoch:authority(tx).key_epoch};
  }
  private verifyOperation(tx:HealthTransaction,actor:GrantRow,revision:Signed<RevisionEnvelope>) {
    const r=revision.command;
    requireSignature("revision",r,revision.signature,actor.signingKey);
    if (r.subjectId!==tx.subjectId || r.actorAccountId!==tx.account.userId || r.actorDeviceId!==actor.deviceId
      || r.grantVersion!==actor.grantVersion || r.keyEpoch!==authority(tx).key_epoch || !inScope(actor,r.resourceId)
      || (r.action==="write" && actor.role!=="owner")) reject("YAOHEZI_ACTION_DENIED");
    if (r.expiresAt<=Date.now() || r.expiresAt>Date.now()+300_000) reject("YAOHEZI_PROOF_EXPIRED");
    return {authorized:true,operationId:r.operationId,ciphertextDigest:r.ciphertextDigest,healthContentAccepted:false};
  }
}
