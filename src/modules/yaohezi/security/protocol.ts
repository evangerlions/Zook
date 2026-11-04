import { createHash, createPublicKey, verify } from "node:crypto";
import type { ErrorCode } from "../../../shared/types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

export interface DeviceDescriptor { deviceId: string; signingKey: string; wrappingKey: string }
export interface RecoveryVault { version: 1; nonce: string; ciphertext: string }
export interface RecoveryMaterial { version: number; publicKey: string; vault: RecoveryVault }
export interface DeviceProofCommand {
  accountId: string; version: 1; subjectId: string; operationId: string; challengeId: string; challengeNonce: string;
  device: DeviceDescriptor; recovery?: RecoveryMaterial; recoveryVersion?: number;
}
export interface Signed<T> { command: T; signature: string }
export interface ManagementCommand {
  actorAccountId: string; version: 1; subjectId: string; operationId: string; actorDeviceId: string;
  grantVersion: number; keyEpoch: number; expiresAt: number;
}
export interface ResourceContext {
  version: 1; subjectId: string; resourceId: string; resourceVersion: string; keyEpoch: number; grantVersion: number;
  recipientAccountId: string; recipientDeviceId: string; recipientWrappingKey: string;
  senderAccountId: string; senderDeviceId: string;
}
export interface KeyCapsule { context: ResourceContext; enc: string; ciphertext: string; signature: string }
export interface RevisionEnvelope {
  version: 1; subjectId: string; resourceId: string; resourceVersion: string; operationId: string; parentRevision: string | null;
  actorAccountId: string; actorDeviceId: string; grantVersion: number; keyEpoch: number;
  action: "read" | "write"; ciphertextDigest: string; expiresAt: number;
}
export interface DeviceGrant {
  device: DeviceDescriptor; userId: string; role: "owner" | "reader"; resources: string[];
  grantVersion: number; keyEpoch: number;
}
export interface EnrollCommand extends ManagementCommand {
  candidate: Signed<DeviceProofCommand>; role: "owner" | "reader"; resources: string[];
}
export type HealthAction = "bootstrap" | "sessions" | "enroll" | "recover" | "inspect" | "revoke-device"
  | "rotate-keys" | "logout" | "key-capsules" | "verify-operation";
export function reject(code: ErrorCode, status = 403): never {
  throw new ApplicationError(status, code, "Health device operation rejected.");
}
export function canonical(value: unknown, depth = 0): string {
  if (depth > 12) reject("YAOHEZI_INVALID_COMMAND", 400);
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isSafeInteger(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(item => canonical(item, depth + 1)).join(",") + "]";
  if (typeof value === "object" && value && Object.getPrototypeOf(value) === Object.prototype) {
    return "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical((value as Record<string, unknown>)[key], depth + 1)).join(",") + "}";
  }
  return reject("YAOHEZI_INVALID_COMMAND", 400);
}
export function signingBytes(domain: string, value: unknown): Buffer {
  return Buffer.from(canonical(["yaohezi-health-v1", domain, value]));
}
export function digest(value: string | Buffer): string { return createHash("sha256").update(value).digest("hex"); }
export function decode(value: string, size?: number): Buffer {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) reject("YAOHEZI_INVALID_COMMAND", 400);
  const bytes = Buffer.from(value, "base64url");
  if (bytes.toString("base64url") !== value || (size !== undefined && bytes.length !== size)) reject("YAOHEZI_INVALID_COMMAND", 400);
  return bytes;
}
export function publicSigningKey(raw: string) {
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), decode(raw, 32)]), format: "der", type: "spki" });
}
export function verifySignature(domain: string, command: unknown, signature: string, key: string): boolean {
  try { return verify(null, signingBytes(domain, command), publicSigningKey(key), decode(signature, 64)); }
  catch { return false; }
}
export function requireSignature(domain: string, command: unknown, signature: string, key: string): void {
  if (!verifySignature(domain, command, signature, key)) reject("YAOHEZI_INVALID_SIGNATURE");
}
export function uuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value); }
export function inScope(grant: Pick<DeviceGrant, "role" | "resources">, resourceId: string): boolean {
  return grant.role === "owner" || grant.resources.includes(resourceId);
}

export interface PublicRootAuthorization {kind:"root";rootKind:"bootstrap"|"recover";subjectId:string;accountId:string;
  device:DeviceDescriptor;keyEpoch:number;recoveryVersion:number;operationId:string;authorizationDigest:string}
export function publicRootAuthorization(kind:"bootstrap"|"recover",proof:Signed<DeviceProofCommand>&{recoverySignature?:string},keyEpoch:number):PublicRootAuthorization {
  const c=proof.command;
  return {kind:"root",rootKind:kind,subjectId:c.subjectId,accountId:c.accountId,device:c.device,keyEpoch,
    recoveryVersion:c.recovery!.version,operationId:c.operationId,authorizationDigest:digest(canonical(proof))};
}
