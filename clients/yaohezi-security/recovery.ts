// Client reference only: production relay never imports this module or handles these secrets.
import { createCipheriv, createDecipheriv, createPrivateKey, createPublicKey, hkdfSync, randomBytes, randomUUID, type KeyObject } from "node:crypto";
import { canonical, decode, signingBytes, uuid, type RecoveryMaterial } from "../../src/modules/yaohezi/security/protocol.ts";
export interface ResourceKey { resourceId:string;resourceVersion:string;keyEpoch:number;key:string }
function checkKeys(keys:unknown): asserts keys is ResourceKey[] {
  if (!Array.isArray(keys) || keys.length>100) throw new Error("Invalid resource-key vault");
  const seen=new Set<string>();
  for (const key of keys) {
    if (!key || Object.keys(key).sort().join(",")!=="key,keyEpoch,resourceId,resourceVersion" || (!uuid(key.resourceId) || !uuid(key.resourceVersion))
      || !Number.isSafeInteger(key.keyEpoch) || key.keyEpoch<1 || key.keyEpoch>2147483647) throw new Error("Invalid resource key");
    decode(key.key,32);const id=key.resourceId+":"+key.resourceVersion+":"+key.keyEpoch;
    if (seen.has(id)) throw new Error("Duplicate resource key");seen.add(id);
  }
}
function derive(secret:Buffer,accountId:string,subjectId:string,label:string):Buffer {
  if (secret.length!==32) throw new Error("Recovery material must contain 256 random bits");
  return Buffer.from(hkdfSync("sha256",secret,signingBytes("recovery-context",{accountId,subjectId}),Buffer.from(label),32));
}
export function recoverySigningKey(secret:Buffer,accountId:string,subjectId:string):KeyObject {
  const seed=derive(secret,accountId,subjectId,"yaohezi-recovery-signing-v1");
  try { return createPrivateKey({key:Buffer.concat([Buffer.from("302e020100300506032b657004220420","hex"),seed]),format:"der",type:"pkcs8"}); }
  finally { seed.fill(0); }
}
export function recoveryPublicKey(secret:Buffer,accountId:string,subjectId:string):string {
  return createPublicKey(recoverySigningKey(secret,accountId,subjectId)).export({type:"spki",format:"der"}).subarray(-32).toString("base64url");
}
function aad(accountId:string,subjectId:string,recoveryVersion:number) {
  return signingBytes("recovery-vault",{version:1,accountId,subjectId,recoveryVersion});
}
export function newRecovery(accountId:string,subjectId:string,version:number,keys:ResourceKey[],secret=randomBytes(32)) {
  if (!uuid(subjectId) || !Number.isSafeInteger(version) || version<1) throw new Error("Invalid recovery context");
  checkKeys(keys);
  const nonce=randomBytes(12),kek=derive(secret,accountId,subjectId,"yaohezi-recovery-vault-v1:"+version);
  const plaintext=Buffer.from(canonical({version:1,keys}));
  try {
    const cipher=createCipheriv("aes-256-gcm",kek,nonce,{authTagLength:16});cipher.setAAD(aad(accountId,subjectId,version));
    const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final(),cipher.getAuthTag()]);
    const material:RecoveryMaterial={version,publicKey:recoveryPublicKey(secret,accountId,subjectId),vault:{version:1,nonce:nonce.toString("base64url"),ciphertext:ciphertext.toString("base64url")}};
    return {secret:Buffer.from(secret),material};
  } finally { kek.fill(0);plaintext.fill(0); }
}
export function openRecovery(material:RecoveryMaterial,secret:Buffer,accountId:string,subjectId:string):ResourceKey[] {
  if (material.vault.version!==1 || recoveryPublicKey(secret,accountId,subjectId)!==material.publicKey) throw new Error("Recovery verification failed");
  const sealed=decode(material.vault.ciphertext),nonce=decode(material.vault.nonce,12);
  if (sealed.length<16 || sealed.length>49152) throw new Error("Invalid recovery vault");
  const kek=derive(secret,accountId,subjectId,"yaohezi-recovery-vault-v1:"+material.version);
  let plaintext:Buffer|undefined;
  try {
    const decipher=createDecipheriv("aes-256-gcm",kek,nonce,{authTagLength:16});
    decipher.setAAD(aad(accountId,subjectId,material.version));decipher.setAuthTag(sealed.subarray(-16));
    plaintext=Buffer.concat([decipher.update(sealed.subarray(0,-16)),decipher.final()]);
    const vault=JSON.parse(plaintext.toString("utf8"));
    if (!vault || Object.keys(vault).sort().join(",")!=="keys,version" || vault.version!==1) throw new Error("Invalid vault");
    checkKeys(vault.keys);return vault.keys;
  } finally {kek.fill(0);plaintext?.fill(0);}
}

/** Fresh per-version future keys; historical keys stay available only for prior content. */
export function rotateResourceKeys(historical:ResourceKey[],nextEpoch:number):ResourceKey[] {
  checkKeys(historical);
  if (!Number.isSafeInteger(nextEpoch) || historical.some(k=>k.keyEpoch>=nextEpoch)) throw new Error("Invalid successor epoch");
  return [...new Set(historical.map(k=>k.resourceId))].map(resourceId=>({resourceId,resourceVersion:randomUUID(),keyEpoch:nextEpoch,key:randomBytes(32).toString("base64url")}));
}
