import { readFileSync } from "node:fs";
import { Aes256Gcm, CipherSuite, DhkemX25519HkdfSha256, HkdfSha256 } from "@hpke/core";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, verify } from "node:crypto";
import test from "node:test";
import { newDevice, newRecovery, openRecovery, rotateResourceKeys, sealResourceKey, openResourceKey } from "../../clients/yaohezi-security/client.ts";
import { publicSigningKey, verifySignature, type ResourceContext } from "../../src/modules/yaohezi/security/protocol.ts";

test("Ed25519 verifies the RFC 8032 empty-message public vector through the platform verifier", () => {
  const publicKey=publicSigningKey(Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a","hex").toString("base64url"));
  assert.ok(verify(null,Buffer.alloc(0),publicKey,Buffer.from("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b","hex")));
  // The application adds a domain and canonical framing, so a raw RFC signature must not validate as an app command.
  assert.equal(verifySignature("revision",{},Buffer.from("e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b","hex").toString("base64url"),Buffer.from("d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a","hex").toString("base64url")),false);
});
test("recovery vault restores resource keys locally and binds account, subject, version and ciphertext", () => {
  const accountId="owner-test",subjectId=randomUUID(),resourceId=randomUUID(),resourceVersion=randomUUID(),key=randomBytes(32);
  const recovery=newRecovery(accountId,subjectId,1,[{resourceId,resourceVersion,keyEpoch:1,key:key.toString("base64url")}]);
  assert.equal(openRecovery(recovery.material,recovery.secret,accountId,subjectId)[0].key,key.toString("base64url"));
  assert.throws(()=>openRecovery(recovery.material,randomBytes(32),accountId,subjectId));
  assert.throws(()=>openRecovery(recovery.material,recovery.secret,"other-account",subjectId));
  assert.throws(()=>openRecovery(recovery.material,recovery.secret,accountId,randomUUID()));
  assert.throws(()=>openRecovery({...recovery.material,version:2},recovery.secret,accountId,subjectId));
  assert.throws(()=>newRecovery(accountId,subjectId,1,[{resourceId,resourceVersion,keyEpoch:1,key:"not-a-key"}]));
});
test("HPKE capsules require pinned sender, exact recipient, current scope/epoch and authentic ciphertext",async()=>{
  const sender=await newDevice(),recipient=await newDevice(),outsider=await newDevice(),subjectId=randomUUID(),resourceId=randomUUID(),resourceVersion=randomUUID(),key=randomBytes(32);
  const context:ResourceContext={version:1,subjectId,resourceId,resourceVersion,keyEpoch:1,grantVersion:1,recipientAccountId:"owner-test",
    recipientDeviceId:recipient.descriptor.deviceId,recipientWrappingKey:recipient.descriptor.wrappingKey,senderAccountId:"owner-test",senderDeviceId:sender.descriptor.deviceId};
  const capsule=await sealResourceKey(key,context,sender);
  const policy={subjectId,accountId:"owner-test",deviceId:recipient.descriptor.deviceId,keyEpoch:1,grantVersion:1,role:"reader" as const,resources:[resourceId]};
  assert.deepEqual(await openResourceKey(capsule,recipient,sender.descriptor,policy),key);
  await assert.rejects(openResourceKey(capsule,outsider,sender.descriptor,policy));
  await assert.rejects(openResourceKey(capsule,recipient,outsider.descriptor,policy));
  await assert.rejects(openResourceKey(capsule,recipient,sender.descriptor,{...policy,resources:[randomUUID()]}));
  await assert.rejects(openResourceKey(capsule,recipient,sender.descriptor,{...policy,keyEpoch:2}));
  const changed={...capsule,context:{...context,resourceId:randomUUID()}};
  await assert.rejects(openResourceKey(changed,recipient,sender.descriptor,policy));
});

test("HPKE decrypts the published RFC 9180 suite vector",async()=>{
  const vector=JSON.parse(readFileSync(new URL("../fixtures/yaohezi-hpke-rfc9180.json",import.meta.url),"utf8"));
  const suite=new CipherSuite({kem:new DhkemX25519HkdfSha256(),kdf:new HkdfSha256(),aead:new Aes256Gcm()});
  const recipientKey=await suite.kem.deserializePrivateKey(Buffer.from(vector.skRm,"hex"));
  const recipient=await suite.createRecipientContext({recipientKey,enc:Buffer.from(vector.enc,"hex"),info:Buffer.from(vector.info,"hex")});
  const plaintext=await recipient.open(Buffer.from(vector.encryption.ct,"hex"),Buffer.from(vector.encryption.aad,"hex"));
  assert.equal(Buffer.from(plaintext).toString("hex"),vector.encryption.pt);
});
test("future resource-key rotation creates fresh independent versions and retains historical keys separately",()=>{
  const resourceId=randomUUID(),historical=[{resourceId,resourceVersion:randomUUID(),keyEpoch:1,key:randomBytes(32).toString("base64url")}];
  const future=rotateResourceKeys(historical,2);
  assert.equal(future.length,1);assert.equal(future[0].resourceId,resourceId);assert.equal(future[0].keyEpoch,2);
  assert.notEqual(future[0].resourceVersion,historical[0].resourceVersion);assert.notEqual(future[0].key,historical[0].key);
  assert.throws(()=>rotateResourceKeys(historical,1));
});
