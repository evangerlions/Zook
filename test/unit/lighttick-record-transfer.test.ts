import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import test from 'node:test';
import {RecordTransferService} from '../../src/modules/lighttick/records/record-transfer.service.ts';
import {LightTickRecordService, type LightTickRecord} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {canonical, digest} from '../../src/modules/lighttick/actions/action.validation.ts';

const SECRET='record-transfer-test-secret-at-least-32-bytes';
const ALICE={appId:'lighttick' as const,userId:'transfer-target-alice'};
const BOB={appId:'lighttick' as const,userId:'transfer-target-bob'};
const SOURCE={instance:'grow-test',subject:'legacy-alice'};
const OPERATION='records-transfer-operation-alice-001';
const SOURCE_ID='ref-'+ 'a'.repeat(32);
const PRIVATE_MARKER='synthetic-private-ai-history-alice-only';

function sampleSnapshot(operationId=OPERATION) {
    const first:LightTickRecord={
        id:SOURCE_ID,raw_text:'导入前的第一版原文',record_date:'2026-10-19',prompt_kind:'free',
        guided_answers:{},tags:['历史'],version:1,
        created_at:'2026-10-19T01:00:00.000Z',updated_at:'2026-10-19T01:00:00.000Z',
    };
    const current:LightTickRecord={...first,raw_text:'用户保留的第二版原文',version:2,updated_at:'2026-10-20T01:00:00.000Z'};
    return {
        format_version:1,source_instance:SOURCE.instance,source_subject:SOURCE.subject,operation_id:operationId,
        entries:[{source_id:SOURCE_ID,record:structuredClone(current),versions:[structuredClone(first),structuredClone(current)],
            private_history:{entry:{original_source:SOURCE_ID},versions:[{version:1,raw_text:first.raw_text},{version:2,raw_text:current.raw_text}],
                attempts:[{id:'synthetic-attempt-001',text:PRIVATE_MARKER}]}}],
    };
}

function freezeReceipt(bindingId:string,snapshotHash:string,operationId=OPERATION,
                       source=SOURCE,secret=SECRET) {
    const value={scope:'records',phase:'frozen',binding_id:bindingId,operation_id:operationId,
        snapshot_hash:snapshotHash,source_instance:source.instance,source_subject:source.subject};
    return {...value,signature:createHmac('sha256',secret).update(canonical(value)).digest('hex')};
}

function fixture() {
    let now=Date.parse('2026-10-25T00:00:00.000Z');
    const repository=new InMemoryLightTickRepository();
    const transfer=new RecordTransferService(repository,{sourceInstance:SOURCE.instance,secret:SECRET},()=>new Date(now));
    const records=new LightTickRecordService(repository,()=>new Date(now));
    return {repository,transfer,records,advance:(milliseconds:number)=>{now+=milliseconds;}};
}

async function bind(f:ReturnType<typeof fixture>,owner=ALICE,source=SOURCE,operationId=OPERATION) {
    const ticket=await f.transfer.ticket(owner);
    const preview=await f.transfer.preview(source,ticket.code);
    assert.equal(preview.target_user_id,owner.userId);
    const binding=await f.transfer.claim(source,{code:ticket.code,operation_id:operationId});
    assert.equal(binding.target_user_id,owner.userId);
    assert.ok(binding.binding_id);
    return {ticket,binding};
}

async function staged(f:ReturnType<typeof fixture>) {
    const {binding}=await bind(f);
    const snapshot=sampleSnapshot();const hash=digest(snapshot);
    await f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:OPERATION,snapshot,snapshot_hash:hash});
    return {binding,snapshot,hash};
}

async function assertNoVisibleRecords(f:ReturnType<typeof fixture>,owner=ALICE) {
    assert.equal((await f.records.list(owner,{archived:'all'})).items.length,0);
    assert.equal((await f.records.export(owner)).records.length,0);
    assert.equal((await f.repository.pullChanges(owner,0,200)).filter(c=>c.entityType==='record').length,0);
}

test('records transfer stages a complete snapshot privately and only a frozen activation publishes it once',async()=>{
    const f=fixture();const {binding,snapshot,hash}=await staged(f);
    await assertNoVisibleRecords(f);
    const receipt=freezeReceipt(binding.binding_id,hash);
    const command={binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,freeze_receipt:receipt};
    await f.transfer.activate(SOURCE,command);
    const first=(await f.records.list(ALICE,{archived:'all'})).items;
    assert.equal(first.length,1);
    assert.equal(first[0].raw_text,snapshot.entries[0].record.raw_text);
    assert.equal(first[0].version,2);
    const firstVersions=(await f.records.versions(ALICE,first[0].id)).items;
    assert.deepEqual(firstVersions.map(v=>v.version).sort((a,b)=>a-b),[1,2]);
    assert.deepEqual(firstVersions.map(v=>v.raw_text).sort(),snapshot.entries[0].versions.map(v=>v.raw_text).sort());
    const firstChanges=(await f.repository.pullChanges(ALICE,0,200)).filter(c=>c.entityType==='record');
    assert.ok(firstChanges.length>0);
    for(let index=0;index<2;index++) await f.transfer.activate(SOURCE,command);
    assert.deepEqual((await f.records.list(ALICE,{archived:'all'})).items,first);
    assert.deepEqual((await f.records.versions(ALICE,first[0].id)).items,firstVersions);
    assert.deepEqual((await f.repository.pullChanges(ALICE,0,200)).filter(c=>c.entityType==='record'),firstChanges);
    const ownExport=JSON.stringify(await f.records.export(ALICE));
    const otherExport=JSON.stringify(await f.records.export(BOB));
    assert.ok(ownExport.includes(PRIVATE_MARKER),'Owner export must preserve original private history, not silently omit it');
    assert.ok(ownExport.includes('source_history'));
    assert.ok(!otherExport.includes(PRIVATE_MARKER));
    assert.ok(!otherExport.includes(SOURCE_ID));
});

test('a missing, forged or non-frozen receipt cannot activate staged records',async()=>{
    const f=fixture();const {binding,hash}=await staged(f);
    const base={binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash};
    await assert.rejects(f.transfer.activate(SOURCE,{...base,freeze_receipt:{} as any}));
    await assertNoVisibleRecords(f);
    await assert.rejects(f.transfer.activate(SOURCE,{...base,freeze_receipt:freezeReceipt(binding.binding_id,hash,OPERATION,SOURCE,'wrong-secret-forged-receipt-signature')}));
    await assertNoVisibleRecords(f);
    await assert.rejects(f.transfer.activate(SOURCE,{...base,freeze_receipt:freezeReceipt(binding.binding_id,'0'.repeat(64))}));
    await assert.rejects(f.transfer.activate(SOURCE,{...base,freeze_receipt:freezeReceipt(binding.binding_id,hash,OPERATION,{...SOURCE,subject:'legacy-bob'})}));
    await assertNoVisibleRecords(f);
    const notFrozen={scope:'records',phase:'active',binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,
        source_instance:SOURCE.instance,source_subject:SOURCE.subject};
    const receipt={...notFrozen,signature:createHmac('sha256',SECRET).update(canonical(notFrozen)).digest('hex')};
    await assert.rejects(f.transfer.activate(SOURCE,{...base,freeze_receipt:receipt}));
    await assertNoVisibleRecords(f);
});

test('source and target bindings are one to one even when another valid ticket is presented',async()=>{
    const f=fixture();await bind(f);
    const bobTicket=await f.transfer.ticket(BOB);
    await assert.rejects(f.transfer.claim(SOURCE,{code:bobTicket.code,operation_id:'other-target-operation-001'}));
    const aliceTicket=await f.transfer.ticket(ALICE);
    await assert.rejects(f.transfer.claim({...SOURCE,subject:'legacy-bob'},{code:aliceTicket.code,operation_id:'other-source-operation-001'}));
    await assertNoVisibleRecords(f,ALICE);await assertNoVisibleRecords(f,BOB);
});

test('concurrent claims cannot bind one Grow source to two target owners',async()=>{
    const f=fixture();const first=await f.transfer.ticket(ALICE),second=await f.transfer.ticket(BOB);
    const claims=await Promise.allSettled([
        f.transfer.claim(SOURCE,{code:first.code,operation_id:'concurrent-alice-operation'}),
        f.transfer.claim(SOURCE,{code:second.code,operation_id:'concurrent-bob-operation'}),
    ]);
    assert.equal(claims.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(claims.filter(result=>result.status==='rejected').length,1);
    await assertNoVisibleRecords(f,ALICE);await assertNoVisibleRecords(f,BOB);
});

test('snapshot tampering, mismatched source and mismatched operation cannot publish or stage another identity',async()=>{
    const f=fixture();const {binding}=await bind(f);
    const snapshot=sampleSnapshot();const hash=digest(snapshot);
    const tampered=structuredClone(snapshot);tampered.entries[0].record.raw_text='传输中被替换的正文';
    await assert.rejects(f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:OPERATION,snapshot:tampered,snapshot_hash:hash}));
    // A recomputed digest must not disguise disagreement between the current record and its declared version.
    await assert.rejects(f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:OPERATION,snapshot:tampered,snapshot_hash:digest(tampered)}));
    await assertNoVisibleRecords(f);
    const wrongSource={...snapshot,source_subject:'legacy-bob'};
    await assert.rejects(f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:OPERATION,snapshot:wrongSource,snapshot_hash:digest(wrongSource)}));
    await assert.rejects(f.transfer.stage({...SOURCE,subject:'legacy-bob'},{binding_id:binding.binding_id,operation_id:OPERATION,snapshot,snapshot_hash:hash}));
    await assert.rejects(f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:'wrong-stage-operation',snapshot,snapshot_hash:hash}));
    await assertNoVisibleRecords(f);
    await f.transfer.stage(SOURCE,{binding_id:binding.binding_id,operation_id:OPERATION,snapshot,snapshot_hash:hash});
    const validReceipt=freezeReceipt(binding.binding_id,hash);
    await assert.rejects(f.transfer.activate(SOURCE,{binding_id:binding.binding_id,operation_id:'wrong-activation-operation',snapshot_hash:hash,freeze_receipt:validReceipt}));
    await assert.rejects(f.transfer.activate({...SOURCE,subject:'legacy-bob'},{binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,freeze_receipt:validReceipt}));
    await assertNoVisibleRecords(f);
});

test('untrusted source instances and expired codes cannot create a records binding',async()=>{
    const f=fixture();const ticket=await f.transfer.ticket(ALICE);
    await assert.rejects(f.transfer.preview({...SOURCE,instance:'untrusted-grow-instance'},ticket.code));
    await assert.rejects(f.transfer.claim({...SOURCE,instance:'untrusted-grow-instance'},{code:ticket.code,operation_id:OPERATION}));
    f.advance(5*60*1000+1000);
    await assert.rejects(f.transfer.preview(SOURCE,ticket.code));
    await assert.rejects(f.transfer.claim(SOURCE,{code:ticket.code,operation_id:OPERATION}));
    await assertNoVisibleRecords(f);
});

test('only confirmed pre-activation cancellation permits a fresh handoff and cannot publish an old freeze receipt',async()=>{
 const f=fixture(),{binding,hash}=await staged(f);
 const old={binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,freeze_receipt:freezeReceipt(binding.binding_id,hash)};
 await f.transfer.cancel(SOURCE,old);await assertNoVisibleRecords(f);
 await assert.rejects(f.transfer.activate(SOURCE,old));
 await assert.rejects(f.transfer.stage(SOURCE,{...old,snapshot:sampleSnapshot()}));
 const next='new-record-handoff-operation',ticket=await f.transfer.ticket(ALICE),bound=await f.transfer.claim(SOURCE,{code:ticket.code,operation_id:next});
 assert.notEqual(bound.binding_id,binding.binding_id);
 const snapshot=sampleSnapshot(next),snapshot_hash=digest(snapshot);
 await f.transfer.stage(SOURCE,{binding_id:bound.binding_id,operation_id:next,snapshot,snapshot_hash});
 await f.transfer.activate(SOURCE,{binding_id:bound.binding_id,operation_id:next,snapshot_hash,freeze_receipt:freezeReceipt(bound.binding_id,snapshot_hash,next)});
 await assert.rejects(f.transfer.cancel(SOURCE,{binding_id:bound.binding_id,operation_id:next}));
 assert.equal((await f.records.list(ALICE)).items.length,1);
});
