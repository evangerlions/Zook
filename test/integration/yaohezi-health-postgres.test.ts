import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import { healthFixture } from "../support/yaohezi-health-fixture.ts";
import { newDevice, newRecovery, openRecovery, openResourceKey, recoverySigningKey, sealResourceKey, signed,
  loadTrustSnapshot, verifyReceivedRevision, bootstrapRootPin, recoveryRootPin, type RootPin } from "../../clients/yaohezi-security/client.ts";
import { digest, type EnrollCommand, type RevisionEnvelope, type Signed } from "../../src/modules/yaohezi/security/protocol.ts";

test("M2 real PostgreSQL/Redis/HTTP: trusted devices, scoped keys, recovery and immediate revocation",async t=>{
  const f=await healthFixture(t),subjectId=randomUUID(),resourceId=randomUUID(),resourceVersion=randomUUID(),hiddenResource=randomUUID();
  const primary=await newDevice(),reader=await newDevice(),secondary=await newDevice();
  const key=randomBytes(32);let recovery=newRecovery(f.accountId,subjectId,1,[{resourceId,resourceVersion,keyEpoch:1,key:key.toString("base64url")}]);
  let primarySession:Awaited<ReturnType<typeof f.session>>,readerSession:Awaited<ReturnType<typeof f.session>>,secondarySession:Awaited<ReturnType<typeof f.session>>;
  const rootPins:RootPin[]=[];
  const loadSnapshot=(device=primary,session=primarySession)=>loadTrustSnapshot({endpoint:new URL(f.origin+"/api/v1/yaohezi/health/inspect"),
    accountToken:f.token,healthSessionToken:session.sessionToken,proof:signed("inspect",f.management(subjectId,device,session),device.signingPrivateKey),
    accountId:f.accountId,subjectId,rootPins,allowLoopbackForTests:true});
  let certificate:Signed<EnrollCommand>;
  await t.test("first trust requires explicit proof; concurrent bootstrap only succeeds once",async()=>{
    const ch=await f.challenge("bootstrap",subjectId,primary);
    const command=f.proof(ch,primary,{confirmed:true,recovery:recovery.material});
    const valid=signed("bootstrap",command,primary.signingPrivateKey);
    rootPins.push(bootstrapRootPin(valid));
    assert.equal((await f.health("bootstrap",{...valid,signature:randomBytes(64).toString("base64url")})).status,403);
    const race=await Promise.all([f.health("bootstrap",valid),f.health("bootstrap",valid)]);
    assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
    primarySession=await f.session(subjectId,primary);
    const headerOnly=await f.health("inspect",{},primarySession.sessionToken);assert.equal(headerOnly.status,400);
    const unsigned=signed("inspect",f.management(subjectId,primary,primarySession),primary.signingPrivateKey);
    assert.equal((await f.health("inspect",unsigned)).code,"YAOHEZI_HEALTH_SESSION_REQUIRED");
  });
  await t.test("candidate substitution and cross-purpose challenge fail; current owner approves a scoped reader",async()=>{
    const ch=await f.challenge("enroll",subjectId,reader);
    const candidate=signed("enroll-proof",f.proof(ch,reader),reader.signingPrivateKey);
    certificate=signed("enroll",f.management(subjectId,primary,primarySession,{candidate,role:"reader",resources:[resourceId]}),primary.signingPrivateKey);
    const changed=structuredClone(certificate);changed.command.candidate.command.device.wrappingKey=secondary.descriptor.wrappingKey;
    assert.equal((await f.health("enroll",changed,primarySession.sessionToken)).code,"YAOHEZI_INVALID_SIGNATURE");
    const wrongPurpose=signed("sessions",f.proof(ch,reader),reader.signingPrivateKey);
    assert.notEqual((await f.health("sessions",wrongPurpose)).status,200);
    const result=await f.health("enroll",certificate,primarySession.sessionToken);assert.equal(result.status,200,JSON.stringify(result));
    readerSession=await f.session(subjectId,reader);
    const illegal=signed("enroll",f.management(subjectId,reader,readerSession,{candidate,role:"owner",resources:[]}),reader.signingPrivateKey);
    assert.equal((await f.health("enroll",illegal,readerSession.sessionToken)).code,"YAOHEZI_ACTION_DENIED");
  });
  await t.test("receiver rejects reader-issued owner certificates even when relay metadata is forged",async()=>{
    const forged=await newDevice(),candidate=signed("enroll-proof",{version:1 as const,accountId:f.accountId,subjectId,operationId:randomUUID(),challengeId:randomUUID(),challengeNonce:randomBytes(32).toString("base64url"),device:forged.descriptor},forged.signingPrivateKey);
    const certificate=signed("enroll",f.management(subjectId,reader,{keyEpoch:1,grantVersion:1},{candidate,role:"owner",resources:[]}),reader.signingPrivateKey);
    // Fault injection in the synthetic relay database: valid reader signatures must not create owner authority at a receiver.
    await f.runtime.database.query("INSERT INTO zook_yaohezi_health_devices(device_id,user_id,signing_key,wrapping_key) VALUES($1,$2,$3,$4)",[forged.descriptor.deviceId,f.accountId,forged.descriptor.signingKey,forged.descriptor.wrappingKey]);
    await f.runtime.database.query("INSERT INTO zook_yaohezi_health_grants(subject_id,device_id,role,resources,grant_version,authorization_proof) VALUES($1,$2,'owner','[]',1,$3)",[subjectId,forged.descriptor.deviceId,JSON.stringify(certificate)]);
    try {await assert.rejects(loadSnapshot());}
    finally {await f.runtime.database.query("DELETE FROM zook_yaohezi_health_grants WHERE subject_id=$1 AND device_id=$2",[subjectId,forged.descriptor.deviceId]);await f.runtime.database.query("DELETE FROM zook_yaohezi_health_devices WHERE device_id=$1",[forged.descriptor.deviceId]);}
  });
  await t.test("immutable key bindings, expired challenges, consumed proofs and replayed operation IDs are rejected",async()=>{
    assert.equal((await f.health("challenges",{subjectId,purpose:"sessions",device:{...primary.descriptor,signingKey:secondary.descriptor.signingKey}})).code,"YAOHEZI_DEVICE_BINDING_MISMATCH");
    const ch=await f.challenge("sessions",subjectId,primary),proof=signed("sessions",f.proof(ch,primary),primary.signingPrivateKey);
    assert.equal((await f.health("sessions",proof)).status,200);
    assert.equal((await f.health("sessions",proof)).code,"YAOHEZI_CHALLENGE_REJECTED");
    const expired=await f.challenge("sessions",subjectId,primary);
    await f.runtime.database.query("UPDATE zook_yaohezi_health_challenges SET expires_at=now()-interval '1 second' WHERE id=$1",[expired.challengeId]);
    assert.equal((await f.health("sessions",signed("sessions",f.proof(expired,primary),primary.signingPrivateKey))).code,"YAOHEZI_CHALLENGE_REJECTED");
    const inspect=signed("inspect",f.management(subjectId,primary,primarySession),primary.signingPrivateKey);
    assert.equal((await f.health("inspect",inspect,primarySession.sessionToken)).status,200);
    const collision=signed("inspect",{...inspect.command,expiresAt:inspect.command.expiresAt-1},primary.signingPrivateKey);
    assert.equal((await f.health("inspect",collision,primarySession.sessionToken)).code,"YAOHEZI_OPERATION_CONFLICT");
  });
  await t.test("HPKE relay delivers only scoped resource capability; unrelated keys and substituted sender fail locally",async()=>{
    const context={version:1 as const,subjectId,resourceId,resourceVersion,keyEpoch:1,grantVersion:1,recipientAccountId:f.accountId,
      recipientDeviceId:reader.descriptor.deviceId,recipientWrappingKey:reader.descriptor.wrappingKey,senderAccountId:f.accountId,senderDeviceId:primary.descriptor.deviceId};
    const capsule=await sealResourceKey(key,context,primary);
    const upload=signed("key-capsules",f.management(subjectId,primary,primarySession,{capsules:[capsule]}),primary.signingPrivateKey);
    assert.equal((await f.health("key-capsules",upload,primarySession.sessionToken)).status,200);
    const denied=await sealResourceKey(randomBytes(32),{...context,resourceId:hiddenResource},primary);
    assert.equal((await f.health("key-capsules",signed("key-capsules",f.management(subjectId,primary,primarySession,{capsules:[denied]}),primary.signingPrivateKey),primarySession.sessionToken)).code,"YAOHEZI_KEY_SCOPE_DENIED");
    const view=await f.health("inspect",signed("inspect",f.management(subjectId,reader,readerSession),reader.signingPrivateKey),readerSession.sessionToken);
    assert.equal(view.status,200);assert.equal(view.data.capsules.length,1);assert.equal(view.data.devices.length,2);
    assert.ok(!JSON.stringify(view.data.devices).includes(recovery.material.vault.ciphertext),"Public trust lineage must not redeliver recovery vaults");
    const policy={subjectId,accountId:f.accountId,deviceId:reader.descriptor.deviceId,keyEpoch:1,grantVersion:1,role:"reader" as const,resources:[resourceId]};
    assert.deepEqual(await openResourceKey(view.data.capsules[0],reader,primary.descriptor,policy),key);
    await assert.rejects(openResourceKey(capsule,reader,secondary.descriptor,policy));
    await assert.rejects(openResourceKey(capsule,reader,primary.descriptor,{...policy,resources:[hiddenResource]}));
  });
  let readRevision:Signed<RevisionEnvelope>;
  await t.test("relay and receiving reference reject a valid read-only signature on a medication mutation",async()=>{
    const ciphertext=randomBytes(48);
    const revision:RevisionEnvelope={version:1,subjectId,resourceId,resourceVersion,operationId:randomUUID(),parentRevision:null,
      actorAccountId:f.accountId,actorDeviceId:reader.descriptor.deviceId,grantVersion:1,keyEpoch:1,action:"write",ciphertextDigest:digest(ciphertext),expiresAt:Date.now()+240_000};
    const write=signed("revision",revision,reader.signingPrivateKey);
    const submit=(r:Signed<RevisionEnvelope>)=>f.health("verify-operation",signed("verify-operation",f.management(subjectId,reader,readerSession,{revision:r}),reader.signingPrivateKey),readerSession.sessionToken);
    assert.equal((await submit(write)).code,"YAOHEZI_ACTION_DENIED");
    const snapshot=await loadSnapshot(),expected={resourceId,resourceVersion,operationId:revision.operationId,parentRevision:null};
    assert.equal(verifyReceivedRevision(write,ciphertext,snapshot,expected),false);
    readRevision=signed("revision",{...revision,action:"read"},reader.signingPrivateKey);
    assert.equal((await submit(readRevision)).status,200);
    assert.equal(verifyReceivedRevision(readRevision,ciphertext,snapshot,expected),true);
    assert.equal(verifyReceivedRevision(readRevision,ciphertext,snapshot,{...expected,resourceId:hiddenResource}),false);
    assert.equal(verifyReceivedRevision(readRevision,ciphertext,snapshot,{...expected,parentRevision:randomUUID()}),false);
    assert.equal(verifyReceivedRevision(readRevision,randomBytes(48),snapshot,expected),false);
    assert.equal(verifyReceivedRevision(readRevision,ciphertext,snapshot,expected,Date.now()+31_000),false);
    const crossSubject=signed("revision",{...revision,subjectId:randomUUID(),action:"read"},reader.signingPrivateKey);
    assert.equal((await submit(crossSubject)).code,"YAOHEZI_ACTION_DENIED");
    const crossResource=signed("revision",{...revision,resourceId:hiddenResource,action:"read"},reader.signingPrivateKey);
    assert.equal((await submit(crossResource)).code,"YAOHEZI_ACTION_DENIED");
  });
  await t.test("available trusted device enrolls a new owner; concurrent use of one approval challenge cannot add twice",async()=>{
    const ch=await f.challenge("enroll",subjectId,secondary),candidate=signed("enroll-proof",f.proof(ch,secondary),secondary.signingPrivateKey);
    const make=()=>signed("enroll",f.management(subjectId,primary,primarySession,{candidate,role:"owner",resources:[]}),primary.signingPrivateKey);
    const results=await Promise.all([f.health("enroll",make(),primarySession.sessionToken),f.health("enroll",make(),primarySession.sessionToken)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);secondarySession=await f.session(subjectId,secondary);
    const snapshot=await loadSnapshot(reader,readerSession),ciphertext=randomBytes(48),operationId=randomUUID();
    const revision=signed("revision",{version:1 as const,subjectId,resourceId,resourceVersion,operationId,parentRevision:null,actorAccountId:f.accountId,
      actorDeviceId:secondary.descriptor.deviceId,grantVersion:1,keyEpoch:1,action:"write" as const,ciphertextDigest:digest(ciphertext),expiresAt:Date.now()+240_000},secondary.signingPrivateKey);
    assert.equal(verifyReceivedRevision(revision,ciphertext,snapshot,{resourceId,resourceVersion,operationId,parentRevision:null}),true);
  });
  await t.test("device revoke serializes with protected operations; still-valid account token cannot bypass revocation",async()=>{
    const next=newRecovery(f.accountId,subjectId,2,[{resourceId,resourceVersion,keyEpoch:1,key:key.toString("base64url")}]);
    const revoke=signed("revoke-device",f.management(subjectId,primary,primarySession,{targetDeviceId:reader.descriptor.deviceId,recovery:next.material}),primary.signingPrivateKey);
    const op=signed("verify-operation",f.management(subjectId,reader,readerSession,{revision:readRevision}),reader.signingPrivateKey);
    const [revoked,racing]=await Promise.all([f.health("revoke-device",revoke,primarySession.sessionToken),f.health("verify-operation",op,readerSession.sessionToken)]);
    assert.equal(revoked.status,200,JSON.stringify(revoked));assert.ok([200,403,409].includes(racing.status));
    const after=await f.health("verify-operation",op,readerSession.sessionToken);assert.equal(after.status,403);
    assert.equal((await f.call("yaohezi/me",undefined,f.token)).status,200,"Account token has not expired/revoked");
    const rows=await f.runtime.database.query("SELECT action,operation_id FROM zook_yaohezi_health_audit WHERE subject_id=$1 ORDER BY id",[subjectId]);
    if (racing.status===200) assert.ok(rows.rows.findIndex(r=>r.operation_id===op.command.operationId)<rows.rows.findIndex(r=>r.operation_id===revoke.command.operationId));
    recovery=next;primarySession=await f.session(subjectId,primary);
    assert.equal((await f.health("inspect",signed("inspect",f.management(subjectId,secondary,secondarySession),secondary.signingPrivateKey),secondarySession.sessionToken)).status,409);
    secondarySession=await f.session(subjectId,secondary);
  });
  await t.test("surviving enrolled owner verifies after its original approving device is revoked",async()=>{
    const next=newRecovery(f.accountId,subjectId,recovery.material.version+1,[{resourceId,resourceVersion,keyEpoch:1,key:key.toString("base64url")}]);
    const command=signed("revoke-device",f.management(subjectId,secondary,secondarySession,{targetDeviceId:primary.descriptor.deviceId,recovery:next.material}),secondary.signingPrivateKey);
    assert.equal((await f.health("revoke-device",command,secondarySession.sessionToken)).status,200);
    recovery=next;secondarySession=await f.session(subjectId,secondary);
    const snapshot=await loadSnapshot(secondary,secondarySession),ciphertext=randomBytes(48),operationId=randomUUID();
    const revision=signed("revision",{version:1 as const,subjectId,resourceId,resourceVersion,operationId,parentRevision:null,actorAccountId:f.accountId,
      actorDeviceId:secondary.descriptor.deviceId,grantVersion:1,keyEpoch:secondarySession.keyEpoch,action:"write" as const,ciphertextDigest:digest(ciphertext),expiresAt:Date.now()+240_000},secondary.signingPrivateKey);
    assert.equal(verifyReceivedRevision(revision,ciphertext,snapshot,{resourceId,resourceVersion,operationId,parentRevision:null}),true);
    assert.equal((await f.health("verify-operation",signed("verify-operation",f.management(subjectId,secondary,secondarySession,{revision}),secondary.signingPrivateKey),secondarySession.sessionToken)).status,200);
  });
  await t.test("durable sessions survive application reopen; logout invalidates a health session immediately",async()=>{
    await f.reopen();
    const view=()=>f.health("inspect",signed("inspect",f.management(subjectId,secondary,secondarySession),secondary.signingPrivateKey),secondarySession.sessionToken);
    assert.equal((await view()).status,200);
    const logout=signed("logout",f.management(subjectId,secondary,secondarySession),secondary.signingPrivateKey);
    assert.equal((await f.health("logout",logout,secondarySession.sessionToken)).status,200);
    assert.equal((await view()).status,403);
    assert.equal((await f.call("yaohezi/me",undefined,f.token)).status,200);
    secondarySession=await f.session(subjectId,secondary);
  });
  await t.test("recovery-material-only decrypts locally, trusts one fresh device and revokes all prior grants/sessions",async()=>{
    const stored=await f.health("recovery",{subjectId});assert.equal(stored.status,200);
    const recovered=openRecovery(stored.data.recovery,recovery.secret,f.accountId,subjectId);assert.equal(recovered[0].key,key.toString("base64url"));
    const restored=await newDevice(),ch=await f.challenge("recover",subjectId,restored);
    const previousVersion=recovery.material.version,nextVersion=previousVersion+1;
    const next=newRecovery(f.accountId,subjectId,nextVersion,[...recovered,{resourceId,resourceVersion,keyEpoch:nextVersion,key:randomBytes(32).toString("base64url")}]);
    const command=f.proof(ch,restored,{recoveryVersion:previousVersion,recovery:next.material});
    const request={...signed("recover",command,restored.signingPrivateKey),recoverySignature:signed("recover-authority",command,recoverySigningKey(recovery.secret,f.accountId,subjectId)).signature};
    const results=await Promise.all([f.health("recover",request),f.health("recover",request)]);
    assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
    assert.equal((await f.health("inspect",signed("inspect",f.management(subjectId,primary,primarySession),primary.signingPrivateKey),primarySession.sessionToken)).status,403);
    assert.equal((await f.health("inspect",signed("inspect",f.management(subjectId,secondary,secondarySession),secondary.signingPrivateKey),secondarySession.sessionToken)).status,403);
    rootPins.splice(0,rootPins.length,recoveryRootPin(request,recovery.material.publicKey,previousVersion));
    const restoredSession=await f.session(subjectId,restored);
    const state=await f.health("inspect",signed("inspect",f.management(subjectId,restored,restoredSession),restored.signingPrivateKey),restoredSession.sessionToken);
    assert.equal(state.data.devices.filter((d:{revoked:boolean})=>!d.revoked).length,1);assert.deepEqual(state.data.capsules,[]);
    const attacker=await newDevice(),attackChallenge=await f.challenge("recover",subjectId,attacker);
    const bad=f.proof(attackChallenge,attacker,{recoveryVersion:nextVersion,recovery:newRecovery(f.accountId,subjectId,nextVersion+1,[]).material});
    assert.equal((await f.health("recover",{...signed("recover",bad,attacker.signingPrivateKey),recoverySignature:signed("recover-authority",bad,recoverySigningKey(recovery.secret,f.accountId,subjectId)).signature})).code,"YAOHEZI_INVALID_SIGNATURE");
    // Keep the fresh trusted device for expiry, block and rotation checks.
    Object.assign(primary,restored);primarySession=restoredSession;recovery=next;
    const snapshot=await loadSnapshot(),ciphertext=randomBytes(48),operationId=randomUUID();
    const revision=signed("revision",{version:1 as const,subjectId,resourceId,resourceVersion,operationId,parentRevision:null,actorAccountId:f.accountId,actorDeviceId:primary.descriptor.deviceId,
      grantVersion:1,keyEpoch:nextVersion,action:"write" as const,ciphertextDigest:digest(ciphertext),expiresAt:Date.now()+240_000},primary.signingPrivateKey);
    assert.equal(verifyReceivedRevision(revision,ciphertext,snapshot,{resourceId,resourceVersion,operationId,parentRevision:null}),true);
  });
  await t.test("all trusted devices/material lost permits account login only, never bootstrap or session fallback",async()=>{
    const unknown=await newDevice();
    assert.equal((await f.health("challenges",{subjectId,purpose:"bootstrap",device:unknown.descriptor})).code,"YAOHEZI_TRUST_ALREADY_ESTABLISHED");
    assert.equal((await f.health("challenges",{subjectId,purpose:"sessions",device:unknown.descriptor})).code,"YAOHEZI_TRUST_REQUIRED");
    const ch=await f.challenge("recover",subjectId,unknown),command=f.proof(ch,unknown,{recoveryVersion:recovery.material.version,recovery:newRecovery(f.accountId,subjectId,recovery.material.version+1,[]).material});
    assert.equal((await f.health("recover",{...signed("recover",command,unknown.signingPrivateKey),recoverySignature:randomBytes(64).toString("base64url")})).code,"YAOHEZI_INVALID_SIGNATURE");
    assert.equal((await f.call("yaohezi/me",undefined,f.token)).status,200);
  });
  await t.test("membership/expiry and explicit rotation fail closed; storage contains only opaque custody material",async()=>{
    await f.runtime.database.query("UPDATE zook_yaohezi_health_sessions SET expires_at=now()-interval '1 second' WHERE device_id=$1",[primary.descriptor.deviceId]);
    const inspect=()=>signed("inspect",f.management(subjectId,primary,primarySession),primary.signingPrivateKey);
    assert.equal((await f.health("inspect",inspect(),primarySession.sessionToken)).status,403);
    primarySession=await f.session(subjectId,primary);
    await f.runtime.database.updateAppUserStatus("yaohezi",f.accountId,"BLOCKED");
    assert.equal((await f.health("inspect",inspect(),primarySession.sessionToken)).status,403);
    await assert.rejects(f.runtime.database.getYaoheziHealthStore()!.handle("inspect",{appId:"yaohezi",userId:f.accountId},inspect(),primarySession.sessionToken),{code:"YAOHEZI_MEMBERSHIP_REQUIRED"});
    await f.runtime.database.updateAppUserStatus("yaohezi",f.accountId,"ACTIVE");
    const rotated=signed("rotate-keys",f.management(subjectId,primary,primarySession,{recovery:newRecovery(f.accountId,subjectId,recovery.material.version+1,[]).material}),primary.signingPrivateKey);
    assert.equal((await f.health("rotate-keys",rotated,primarySession.sessionToken)).status,200);
    assert.equal((await f.health("inspect",inspect(),primarySession.sessionToken)).code,"YAOHEZI_STALE_AUTHORITY");
    const rows=await f.runtime.database.query("SELECT recovery_public_key,recovery_vault FROM zook_yaohezi_health_authorities WHERE subject_id=$1",[subjectId]);
    assert.ok(!JSON.stringify(rows.rows).includes(key.toString("base64url")));
    assert.ok(!JSON.stringify(rows.rows).includes(recovery.secret.toString("base64url")));
    const tokens=await f.runtime.database.query("SELECT token_hash FROM zook_yaohezi_health_sessions WHERE subject_id=$1",[subjectId]);
    assert.ok(tokens.rows.every(r=>r.token_hash!==primarySession.sessionToken && /^[0-9a-f]{64}$/.test(r.token_hash)));
  });
  await t.test("other accounts/products and unknown secret fields are rejected",async()=>{
    primarySession=await f.session(subjectId,primary);
    const proof=signed("inspect",f.management(subjectId,primary,primarySession),primary.signingPrivateKey);
    const other=await f.loginAccount();
    assert.equal((await f.health("inspect",proof,primarySession.sessionToken,other.accessToken)).status,403);
    const wrongProduct=await f.call("auth/login",{appId:"app_a",account:"alice@example.com",password:"Password1234",clientType:"app"});
    assert.equal(wrongProduct.status,200);
    assert.equal((await f.health("inspect",proof,primarySession.sessionToken,wrongProduct.data.accessToken)).status,403);
    const noPrivateKey={...proof,command:{...proof.command,privateKey:"synthetic-not-permitted"}};
    assert.equal((await f.health("inspect",noPrivateKey,primarySession.sessionToken)).status,400);
  });
  await t.test("challenge issuance is bounded per account and has no device-header fallback",async()=>{
    let limited=false;
    for (let i=0;i<21;i++) {
      const result=await f.health("challenges",{subjectId,purpose:"sessions",device:primary.descriptor});
      if (result.status===429) {limited=true;break;}
      assert.equal(result.status,200);
    }
    assert.ok(limited);
  });

});

test("M2 device-signed close can cancel unknown-bearer session creation before or after commit", async t => {
  const f=await healthFixture(t),subjectId=randomUUID(),device=await newDevice();
  const recovery=newRecovery(f.accountId,subjectId,1,[]);
  const boot=await f.challenge("bootstrap",subjectId,device);
  assert.equal((await f.health("bootstrap",signed("bootstrap",f.proof(boot,device,{confirmed:true,recovery:recovery.material}),device.signingPrivateKey))).status,200);
  const proof=async()=>{const c=await f.challenge("sessions",subjectId,device);return signed("sessions",f.proof(c,device),device.signingPrivateKey);};
  const close=(operationId:string,signer=device)=>f.health("close-sessions",signed("close-sessions",{version:1,subjectId,operationId:randomUUID(),actorAccountId:f.accountId,
    actorDeviceId:device.descriptor.deviceId,expiresAt:Date.now()+240_000,creationOperationIds:[operationId]},signer.signingPrivateKey));
  const pending=await proof();
  assert.equal((await close(pending.command.operationId)).status,200);
  const late=await f.health("sessions",pending);
  assert.equal(late.code,"YAOHEZI_SESSION_CREATION_CLOSED");
  const committed=await proof(),session=await f.health("sessions",committed);assert.equal(session.status,200);
  assert.equal(session.data.creationOperationId,committed.command.operationId);
  const other=await newDevice();assert.equal((await close(committed.command.operationId,other)).status,403);
  assert.equal((await close(committed.command.operationId)).status,200);
  assert.equal((await close(committed.command.operationId)).status,200,"Repeated negative cleanup is idempotent");
  const inspect=signed("inspect",f.management(subjectId,device,session.data),device.signingPrivateKey);
  assert.equal((await f.health("inspect",inspect,session.data.sessionToken)).code,"YAOHEZI_HEALTH_SESSION_REQUIRED");
  const fresh=await f.session(subjectId,device);assert.equal(fresh.role,"owner");
});


test("M2 creation cleanup isolates devices/accounts, survives revocation and serializes concurrent creation", async t => {
  const f=await healthFixture(t),subjectId=randomUUID(),primary=await newDevice(),secondary=await newDevice();
  const recovery=newRecovery(f.accountId,subjectId,1,[]);
  const boot=await f.challenge("bootstrap",subjectId,primary);
  assert.equal((await f.health("bootstrap",signed("bootstrap",f.proof(boot,primary,{confirmed:true,recovery:recovery.material}),primary.signingPrivateKey))).status,200);
  const primarySession=await f.session(subjectId,primary);
  const candidate=await f.challenge("enroll",subjectId,secondary);
  const enroll=signed("enroll",f.management(subjectId,primary,primarySession,{candidate:signed("enroll-proof",f.proof(candidate,secondary),secondary.signingPrivateKey),role:"owner",resources:[]}),primary.signingPrivateKey);
  assert.equal((await f.health("enroll",enroll,primarySession.sessionToken)).status,200);
  const secondarySession=await f.session(subjectId,secondary);
  const closeProof=(device:typeof primary,ids:string[],extras={})=>signed("close-sessions",{
    version:1,subjectId,operationId:randomUUID(),actorAccountId:f.accountId,actorDeviceId:device.descriptor.deviceId,
    expiresAt:Date.now()+240_000,creationOperationIds:ids,...extras},device.signingPrivateKey);
  const creationId=secondarySession.creationOperationId;
  assert.equal((await f.health("close-sessions",closeProof(primary,[creationId]))).status,200);
  const inspect=()=>signed("inspect",f.management(subjectId,secondary,secondarySession),secondary.signingPrivateKey);
  assert.equal((await f.health("inspect",inspect(),secondarySession.sessionToken)).status,200,"One device cannot revoke another device's creation even within the same account");
  const other=await f.loginAccount();
  assert.equal((await f.health("close-sessions",closeProof(secondary,[creationId]),undefined,other.accessToken)).status,403);
  assert.equal((await f.health("close-sessions",closeProof(secondary,[creationId],{expiresAt:Date.now()-1}))).status,403);
  assert.equal((await f.health("close-sessions",closeProof(secondary,[creationId,creationId]))).status,400);
  assert.equal((await f.health("inspect",inspect(),secondarySession.sessionToken)).status,200,"Rejected cleanup leaves the session usable");

  const ch=await f.challenge("sessions",subjectId,secondary);
  const pending=signed("sessions",f.proof(ch,secondary),secondary.signingPrivateKey);
  const [created,closed]=await Promise.all([f.health("sessions",pending),f.health("close-sessions",closeProof(secondary,[pending.command.operationId]))]);
  assert.equal(closed.status,200);
  assert.ok(created.status===200 || created.code==="YAOHEZI_SESSION_CREATION_CLOSED");
  const rows=await f.runtime.database.query("SELECT revoked FROM zook_yaohezi_health_sessions WHERE subject_id=$1 AND device_id=$2 AND creation_operation_id=$3",[subjectId,secondary.descriptor.deviceId,pending.command.operationId]);
  assert.ok(rows.rows.every(row=>row.revoked),"After cleanup commits, no ordering may leave an active session");
  assert.equal((await f.health("sessions",pending)).code,"YAOHEZI_SESSION_CREATION_CLOSED");

  const next=newRecovery(f.accountId,subjectId,2,[]);
  const revoke=signed("revoke-device",f.management(subjectId,primary,primarySession,{targetDeviceId:secondary.descriptor.deviceId,recovery:next.material}),primary.signingPrivateKey);
  assert.equal((await f.health("revoke-device",revoke,primarySession.sessionToken)).status,200);
  const cleanup=closeProof(secondary,[creationId]);
  assert.equal((await f.health("close-sessions",cleanup)).status,200,"Revoked device retains only negative cleanup capability");
  assert.equal((await f.health("close-sessions",cleanup)).status,200,"Exact request replay is safe");
  await f.reopen();
  assert.equal((await f.health("close-sessions",cleanup)).status,200,"Tombstones and cleanup survive reconnect");
  assert.equal((await f.health("challenges",{subjectId,purpose:"sessions",device:secondary.descriptor})).status,403);
});
