import { canonical, digest, inScope, publicRootAuthorization, verifySignature, type DeviceDescriptor, type DeviceProofCommand,
  type EnrollCommand, type ManagementCommand, type PublicRootAuthorization, type RevisionEnvelope, type Signed } from "../../src/modules/yaohezi/security/protocol.ts";
import { validateHealthRequest, validRevision, validTrustData } from "../../src/modules/yaohezi/security/validation.ts";
/** An independently verified out-of-band anchor. Never populate from the relay device list. */
export type RootPin=PublicRootAuthorization;
export function bootstrapRootPin(proof:Signed<DeviceProofCommand>):RootPin {
  validateHealthRequest("bootstrap",proof);
  if (proof.command.recovery?.version!==1 || !verifySignature("bootstrap",proof.command,proof.signature,proof.command.device.signingKey)) throw new Error("Invalid bootstrap anchor");
  return publicRootAuthorization("bootstrap",proof,1);
}
export function recoveryRootPin(proof:Signed<DeviceProofCommand>&{recoverySignature:string},previousVerifier:string,previousVersion:number):RootPin {
  validateHealthRequest("recover",proof);const c=proof.command;
  if (c.recoveryVersion!==previousVersion || c.recovery?.version!==previousVersion+1 || !verifySignature("recover",c,proof.signature,c.device.signingKey)
    || !verifySignature("recover-authority",c,proof.recoverySignature,previousVerifier)) throw new Error("Invalid recovery anchor");
  return publicRootAuthorization("recover",proof,previousVersion+1);
}
interface WireGrant {device:DeviceDescriptor;accountId:string;role:"owner"|"reader";
  resources:string[];grantVersion:number;revoked:boolean;authorization:Signed<EnrollCommand>|PublicRootAuthorization}
interface TrustData {subjectId:string;accountId:string;keyEpoch:number;recoveryVersion:number;snapshotNonce:string;
  issuedAt:number;validUntil:number;devices:WireGrant[]}
interface VerifiedGrant {device:DeviceDescriptor;accountId:string;role:"owner"|"reader";resources:string[];grantVersion:number;revoked:boolean}
/** Created only by the authenticated HTTPS loader plus independent root/certificate validation. */
class TrustSnapshot {
  constructor(readonly subjectId:string,readonly accountId:string,readonly keyEpoch:number,readonly validUntil:number,
    readonly grants:ReadonlyMap<string,VerifiedGrant>) {}
}
export interface TrustSnapshotRequest {endpoint:URL;accountToken:string;healthSessionToken:string;proof:Signed<ManagementCommand>;
  accountId:string;subjectId:string;rootPins:RootPin[];allowLoopbackForTests?:boolean}
function validateSnapshot(data:TrustData,request:TrustSnapshotRequest):TrustSnapshot {
  const now=Date.now();
  if (!validTrustData(data) || !data || data.subjectId!==request.subjectId || data.accountId!==request.accountId || data.snapshotNonce!==request.proof.command.operationId
    || !Number.isSafeInteger(data.keyEpoch) || data.keyEpoch<1 || data.keyEpoch!==request.proof.command.keyEpoch
    || data.recoveryVersion!==data.keyEpoch || !Number.isSafeInteger(data.issuedAt) || !Number.isSafeInteger(data.validUntil)
    || data.issuedAt>now+2000 || data.issuedAt<now-30_000 || data.validUntil<=now || data.validUntil>data.issuedAt+30_000
    || !Array.isArray(data.devices) || data.devices.length>100) throw new Error("Stale or unbound trust snapshot");
  const rows=new Map(data.devices.map(r=>[r.device.deviceId,r]));
  if (rows.size!==data.devices.length) throw new Error("Duplicate trust entry");
  const validated=new Map<string,VerifiedGrant>(),visiting=new Set<string>();
  const check=(id:string):VerifiedGrant=>{
    const cached=validated.get(id);if (cached) return cached;
    const row=rows.get(id);if (!row || visiting.has(id)) throw new Error("Unrooted trust chain");visiting.add(id);
    if (row.accountId!==data.accountId || !["owner","reader"].includes(row.role) || row.grantVersion<1 || typeof row.revoked!=="boolean"
      || !Array.isArray(row.resources) || row.resources.some(r=>typeof r!=="string")) throw new Error("Invalid grant");
    const device=row.device;
    const proof=row.authorization;
    if (!("kind" in proof)) {
      const c=proof.command;
      validateHealthRequest("enroll",proof);
      const issuer=check(c.actorDeviceId),candidate=c.candidate.command;
      // Issuer's historical role is immutable. Its later revocation does not undo an already accepted surviving grant.
      if (issuer.role!=="owner" || c.grantVersion!==1 || c.actorAccountId!==data.accountId || c.subjectId!==data.subjectId
        || c.keyEpoch>data.keyEpoch || c.keyEpoch<1 || candidate.accountId!==data.accountId || candidate.subjectId!==data.subjectId
        || canonical(candidate.device)!==canonical(device) || c.role!==row.role || canonical(c.resources)!==canonical(row.resources)
        || !verifySignature("enroll",c,proof.signature,issuer.device.signingKey)
        || !verifySignature("enroll-proof",candidate,c.candidate.signature,device.signingKey)) throw new Error("Invalid device authorization");
    } else {
      const pin=request.rootPins.find(p=>canonical(p.device)===canonical(device));
      if (!pin || canonical(pin)!==canonical(proof) || row.role!=="owner" || row.resources.length
        || proof.accountId!==data.accountId || proof.subjectId!==data.subjectId || proof.keyEpoch>data.keyEpoch
        || proof.recoveryVersion!==proof.keyEpoch) throw new Error("Unpinned root");
    }
    const result={device,accountId:row.accountId,role:row.role,resources:row.resources,grantVersion:row.grantVersion,revoked:row.revoked};
    visiting.delete(id);validated.set(id,result);return result;
  };
  for (const row of data.devices) if (!row.revoked) check(row.device.deviceId);
  return new TrustSnapshot(data.subjectId,data.accountId,data.keyEpoch,data.validUntil,validated);
}
export async function loadTrustSnapshot(request:TrustSnapshotRequest):Promise<TrustSnapshot> {
  const url=request.endpoint;
  const local=request.allowLoopbackForTests && url.protocol==="http:" && url.hostname==="127.0.0.1";
  if ((!local && url.protocol!=="https:") || url.username || url.password || url.search || url.hash || url.pathname!=="/api/v1/yaohezi/health/inspect") throw new Error("Invalid trust endpoint");
  if (request.proof.command.subjectId!==request.subjectId || request.proof.command.actorAccountId!==request.accountId) throw new Error("Unbound trust request");
  const response=await fetch(url,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${request.accountToken}`,
    "x-yaohezi-health-session":request.healthSessionToken},body:JSON.stringify(request.proof),redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(5000)});
  if (!response.ok) throw new Error("Current trust unavailable");
  const envelope=await response.json();if (envelope.code!=="OK") throw new Error("Current trust unavailable");
  return validateSnapshot(envelope.data,request);
}
/** Authorization only; M3 must additionally validate ingestion receipt, revision graph and clinical conflicts. */
export function verifyReceivedRevision(revision:Signed<RevisionEnvelope>,ciphertext:Buffer,snapshot:TrustSnapshot,
  expected:{resourceId:string;resourceVersion:string;operationId:string;parentRevision:string|null},now=Date.now()):boolean {
  try {
    if (!validRevision(revision) || snapshot.validUntil<=now) return false;
    const r=revision.command,actor=snapshot.grants.get(r.actorDeviceId);
    return !!actor && !actor.revoked && r.subjectId===snapshot.subjectId && r.actorAccountId===snapshot.accountId
      && r.resourceId===expected.resourceId && r.resourceVersion===expected.resourceVersion && r.operationId===expected.operationId && r.parentRevision===expected.parentRevision
      && r.keyEpoch===snapshot.keyEpoch && r.grantVersion===actor.grantVersion && r.expiresAt>now && r.expiresAt<=now+300_000
      && r.ciphertextDigest===digest(ciphertext) && inScope(actor,r.resourceId) && (actor.role==="owner" || r.action==="read")
      && verifySignature("revision",r,revision.signature,actor.device.signingKey);
  } catch {return false;}
}
