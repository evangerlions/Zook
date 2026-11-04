// Node/TypeScript interoperability reference. Not imported by the relay or an iOS implementation.
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from "node:crypto";
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import { canonical, decode, digest, inScope, signingBytes, verifySignature, type DeviceDescriptor, type EnrollCommand,
  type KeyCapsule, type ResourceContext, type RevisionEnvelope, type Signed } from "../../src/modules/yaohezi/security/protocol.ts";
export {newRecovery,openRecovery,recoverySigningKey,rotateResourceKeys} from "./recovery.ts";
const suite=new CipherSuite({kem:new DhkemX25519HkdfSha256(),kdf:new HkdfSha256(),aead:new Aes256Gcm()});
export interface ClientDevice {descriptor:DeviceDescriptor;signingPrivateKey:KeyObject;wrappingPrivateKey:CryptoKey}
export async function newDevice():Promise<ClientDevice> {
  const signing=generateKeyPairSync("ed25519"),wrapping=await suite.kem.generateKeyPair();
  return {descriptor:{deviceId:randomUUID(),signingKey:signing.publicKey.export({type:"spki",format:"der"}).subarray(-32).toString("base64url"),
    wrappingKey:Buffer.from(await suite.kem.serializePublicKey(wrapping.publicKey)).toString("base64url")},signingPrivateKey:signing.privateKey,wrappingPrivateKey:wrapping.privateKey};
}
export function signed<T>(domain:string,command:T,key:KeyObject):Signed<T> {
  return {command,signature:sign(null,signingBytes(domain,command),key).toString("base64url")};
}
export async function sealResourceKey(key:Buffer,context:ResourceContext,sender:ClientDevice):Promise<KeyCapsule> {
  if (key.length!==32 || context.senderDeviceId!==sender.descriptor.deviceId) throw new Error("Invalid resource key context");
  const recipientPublicKey=await suite.kem.deserializePublicKey(decode(context.recipientWrappingKey,32));
  const session=await suite.createSenderContext({recipientPublicKey,info:signingBytes("resource-key-suite",{version:1})});
  const enc=Buffer.from(session.enc).toString("base64url");
  const ciphertext=Buffer.from(await session.seal(key,signingBytes("resource-key-context",context))).toString("base64url");
  const unsigned={context,enc,ciphertext};return {...unsigned,signature:signed("key-capsule",unsigned,sender.signingPrivateKey).signature};
}
export interface RecipientPolicy {subjectId:string;accountId:string;deviceId:string;keyEpoch:number;grantVersion:number;role:"owner"|"reader";resources:string[]}
export async function openResourceKey(capsule:KeyCapsule,recipient:ClientDevice,pinnedSender:DeviceDescriptor,policy:RecipientPolicy):Promise<Buffer> {
  const k=capsule.context;
  if (k.version!==1 || k.subjectId!==policy.subjectId || k.keyEpoch!==policy.keyEpoch || k.grantVersion!==policy.grantVersion
    || k.recipientAccountId!==policy.accountId || k.recipientDeviceId!==policy.deviceId || k.recipientDeviceId!==recipient.descriptor.deviceId
    || k.recipientWrappingKey!==recipient.descriptor.wrappingKey || k.senderDeviceId!==pinnedSender.deviceId || !inScope(policy,k.resourceId)
    || !verifySignature("key-capsule",{context:k,enc:capsule.enc,ciphertext:capsule.ciphertext},capsule.signature,pinnedSender.signingKey)) throw new Error("Untrusted resource capsule");
  const session=await suite.createRecipientContext({recipientKey:recipient.wrappingPrivateKey,enc:decode(capsule.enc,32),info:signingBytes("resource-key-suite",{version:1})});
  const key=Buffer.from(await session.open(decode(capsule.ciphertext,48),signingBytes("resource-key-context",k)));
  if (key.length!==32) throw new Error("Invalid resource key");return key;
}
export type {RootPin} from "./trust.ts";
export {loadTrustSnapshot,verifyReceivedRevision,bootstrapRootPin,recoveryRootPin} from "./trust.ts";
/** Show/compare this on both devices before approving; no server-supplied display name is identity proof. */
export function deviceFingerprint(descriptor:DeviceDescriptor):string {return digest(canonical(descriptor));}
