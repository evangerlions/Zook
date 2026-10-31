import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import test from 'node:test';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {createApplication} from '../support/create-test-application.ts';
import {canonical,digest} from '../../src/modules/lighttick/actions/action.validation.ts';

const PREFIX='/api/v1/lighttick/';
const SECRET='record-http-fixture-secret-at-least-32-characters';
const SOURCE={instance:'grow-http-test',subject:'legacy-http-alice'};
const OWNER={appId:'lighttick' as const,userId:'user_alice'};
const OPERATION='records-http-transfer-operation-001';
const SOURCE_ID='ref-'+'b'.repeat(32);
const PRIVATE_MARKER='synthetic-http-private-history-alice-only';

async function fixture(enabled=true) {
    const keys=['LIGHTTICK_RECORD_HANDOFF_ENABLED','GROW_RECORDS_SOURCE_ID','GROW_RECORDS_BRIDGE_SECRET'];
    const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
    process.env.LIGHTTICK_RECORD_HANDOFF_ENABLED=enabled?'1':'0';
    process.env.GROW_RECORDS_SOURCE_ID=SOURCE.instance;process.env.GROW_RECORDS_BRIDGE_SECRET=SECRET;
    try {
        const seed=buildDefaultSeed(undefined,{includeLightTick:true});
        for(const userId of ['user_alice','user_bob']) seed.appUsers.push({id:'record-http-'+userId,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
        const application=await createApplication({seed,lighttickEnabled:true});
        const native=(method:string,path:string,body?:unknown,userId='user_alice',key='record-http-write-'+randomUUID())=>application.app.handle({
            method,path:PREFIX+path,headers:{authorization:'Bearer '+application.services.tokenService.issueAccessToken(userId,'lighttick'),'x-app-id':'lighttick','idempotency-key':key},
            body,requestId:'record-http-'+randomUUID(),
        } as any);
        function proof(input:Record<string,unknown>,nonce='record-proof-'+randomUUID(),stamp=String(Math.floor(Date.now()/1000)),source=SOURCE) {
            return {'x-grow-instance':source.instance,'x-grow-account-id':source.subject,'x-grow-timestamp':stamp,'x-grow-nonce':nonce,
                'x-grow-signature':createHmac('sha256',SECRET).update([source.instance,source.subject,stamp,nonce,canonical(input)].join('\n')).digest('hex')};
        }
        const bridge=(input:Record<string,unknown>,headers=proof(input))=>application.app.handle({method:'POST',path:PREFIX+'record-bridge',headers,body:input,requestId:'record-bridge-'+randomUUID()});
        return {application,native,proof,bridge,repository:application.services.lighttickRepository};
    } finally {
        for(const key of keys){if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}
    }
}

function snapshot() {
    const first={id:SOURCE_ID,raw_text:'旧端第一版',record_date:'2026-10-19',prompt_kind:'free',guided_answers:{},tags:['合成历史'],version:1,created_at:'2026-10-19T01:00:00.000Z',updated_at:'2026-10-19T01:00:00.000Z'};
    const latest={...first,raw_text:'旧端第二版',version:2,updated_at:'2026-10-20T01:00:00.000Z'};
    return {format_version:1,source_instance:SOURCE.instance,source_subject:SOURCE.subject,operation_id:OPERATION,
        entries:[{source_id:SOURCE_ID,record:structuredClone(latest),versions:[structuredClone(first),structuredClone(latest)],
            private_history:{entry:{source_id:SOURCE_ID},versions:[],attempts:[{id:'http-history-attempt',content:PRIVATE_MARKER}]}}]};
}

async function linked(f:Awaited<ReturnType<typeof fixture>>,activate=false) {
    const ticket=await f.native('POST','record-link/tickets');assert.equal(ticket.statusCode,200,JSON.stringify(ticket.body));
    const claim=await f.bridge({action:'claim',code:(ticket.body.data as any).code,operation_id:OPERATION});assert.equal(claim.statusCode,200,JSON.stringify(claim.body));
    const binding=claim.body.data as any;
    if(!activate)return binding;
    const pack=snapshot(),hash=digest(pack);
    const staged=await f.bridge({action:'stage',binding_id:binding.binding_id,operation_id:OPERATION,snapshot:pack,snapshot_hash:hash});assert.equal(staged.statusCode,200,JSON.stringify(staged.body));
    const freeze={scope:'records',phase:'frozen',binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,source_instance:SOURCE.instance,source_subject:SOURCE.subject};
    const receipt={...freeze,signature:createHmac('sha256',SECRET).update(canonical(freeze)).digest('hex')};
    const activated=await f.bridge({action:'activate',binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:hash,freeze_receipt:receipt});assert.equal(activated.statusCode,200,JSON.stringify(activated.body));
    return {...binding,snapshot_hash:hash,freeze_receipt:receipt};
}

function write(raw_text:string,base_version:number) {
    return {raw_text,record_date:'2026-10-25',prompt_kind:'free',guided_answers:{},tags:[],base_version};
}

test('record handoff HTTP is feature-gated and never accepts unsigned or guest native access',async()=>{
    const disabled=await fixture(false);
    assert.equal((await disabled.native('POST','record-link/tickets')).statusCode,503);
    assert.equal((await disabled.bridge({action:'status'})).statusCode,503);
    const f=await fixture();
    assert.equal((await f.application.app.handle({method:'POST',path:PREFIX+'record-link/tickets',headers:{}})).statusCode,401);
    const guest=await f.application.app.handle({method:'POST',path:PREFIX+'account/guest-sessions',headers:{'idempotency-key':'record-http-guest-001'},
        body:{device_id:'record-http-device',device_secret:'record-http-device-secret-at-least-32-characters',platform:'ios',timezone:'Asia/Shanghai',locale:'zh-CN',app_version:'0.1.0'}});
    assert.equal(guest.statusCode,201,JSON.stringify(guest.body));
    const guestHeaders={authorization:'Bearer '+(guest.body.data as any).access_token,'x-app-id':'lighttick'};
    for(const [method,path] of [['POST','tickets'],['GET','status'],['POST','readonly']]) {
        const result=await f.application.app.handle({method,path:PREFIX+'record-link/'+path,headers:guestHeaders} as any);
        assert.equal(result.statusCode,403,JSON.stringify(result.body));
    }
    assert.equal((await f.application.app.handle({method:'POST',path:PREFIX+'record-bridge',headers:{},body:{action:'status'}})).statusCode,403);
});

test('signed bridge proofs reject body/header tampering, expiry and nonce replay without leaking source data',async()=>{
    const f=await fixture();const ticket=await f.native('POST','record-link/tickets');const code=(ticket.body.data as any).code;
    const body={action:'preview',code},headers=f.proof(body);
    const first=await f.bridge(body,headers);assert.equal(first.statusCode,200,JSON.stringify(first.body));
    assert.equal((await f.bridge(body,headers)).statusCode,403);
    assert.equal((await f.bridge({...body,code:'f'.repeat(36)},f.proof(body))).statusCode,403);
    assert.equal((await f.bridge(body,{...f.proof(body),'x-grow-account-id':'legacy-http-bob'})).statusCode,403);
    assert.equal((await f.bridge(body,f.proof(body,undefined,String(Math.floor(Date.now()/1000)-121)))).statusCode,403);
    assert.equal((await f.bridge(body,f.proof(body))).statusCode,200);
    const empty=await f.native('GET','records/export');assert.equal((empty.body.data as any).records.length,0);
    assert.ok(!JSON.stringify(first.body).includes(PRIVATE_MARKER));
});

test('a bound source loses all bridge access when its LightTick target membership is disabled',async()=>{
    const f=await fixture();await linked(f,true);
    const before=await f.repository.listRecords(OWNER);
    await f.application.database.updateAppUserStatus('lighttick','user_alice','BLOCKED');
    const status=await f.bridge({action:'status'});assert.equal(status.statusCode,403,JSON.stringify(status.body));
    const exported=await f.bridge({action:'request',method:'GET',path:'export'});assert.equal(exported.statusCode,403);
    assert.ok(!JSON.stringify(exported.body).includes(PRIVATE_MARKER));
    const stage=await f.bridge({action:'stage',binding_id:'untrusted-input',operation_id:OPERATION,snapshot:snapshot(),snapshot_hash:digest(snapshot())});
    assert.equal(stage.statusCode,403,JSON.stringify(stage.body));
    assert.equal((await f.native('GET','record-link/status')).statusCode,403);
    assert.deepEqual(await f.repository.listRecords(OWNER),before);
});

test('active-to-readonly exports newest records with private history and blocks native and bridge mutations with 423',async()=>{
    const f=await fixture();await linked(f,true);
    const page=await f.native('GET','records');const imported=(page.body.data as any).items[0];
    assert.ok(imported);assert.equal(imported.version,2);
    const edited=await f.native('PUT','records/'+imported.id,write('原生端最新第三版',2));assert.equal(edited.statusCode,200,JSON.stringify(edited.body));
    const created=await f.native('PUT','records/record-http-native-new-001',write('接管后新增原文',0));assert.equal(created.statusCode,200);
    const archived=await f.native('POST','records/record-http-native-new-001/archive',{base_version:1});assert.equal(archived.statusCode,200);
    const readonly=await f.native('POST','record-link/readonly');assert.equal(readonly.statusCode,200,JSON.stringify(readonly.body));
    const exported=(readonly.body.data as any).export;
    assert.equal((readonly.body.data as any).phase,'readonly');assert.equal(exported.records.length,2);
    const current=exported.records.find((item:any)=>item.record.id===imported.id);
    assert.equal(current.record.raw_text,'原生端最新第三版');assert.equal(current.record.version,3);assert.equal(current.versions.length,3);
    const archivedExport=exported.records.find((item:any)=>item.record.id==='record-http-native-new-001');
    assert.ok(archivedExport.record.archived_at);assert.equal(archivedExport.versions.length,2);
    assert.ok(JSON.stringify(current.source_history).includes(PRIVATE_MARKER));
    const before=JSON.stringify((await f.native('GET','records/export')).body.data);
    assert.equal((await f.native('PUT','records/'+imported.id,write('禁止覆盖',3))).statusCode,423);
    assert.equal((await f.native('PUT','records/record-http-native-forbidden',write('禁止新增',0))).statusCode,423);
    assert.equal((await f.native('POST','records/'+imported.id+'/archive',{base_version:3})).statusCode,423);
    const bridgeWrite=await f.bridge({action:'request',method:'PUT',path:'save',id:imported.id,body:write('禁止桥接覆盖',3),key:'record-http-bridge-forbidden'});
    assert.equal(bridgeWrite.statusCode,423,JSON.stringify(bridgeWrite.body));
    const bridgeRead=await f.bridge({action:'request',method:'GET',path:'export'});assert.equal(bridgeRead.statusCode,200);
    assert.ok(JSON.stringify(bridgeRead.body.data).includes('原生端最新第三版'));
    const after=await f.native('GET','records/export');
    const stable=(value:any)=>JSON.stringify(value.records);
    assert.equal(stable(after.body.data),stable(JSON.parse(before)));
    const other=await f.native('GET','records/export',undefined,'user_bob');assert.ok(!JSON.stringify(other.body.data).includes(PRIVATE_MARKER));
});

test('deleting LightTick removes records, histories and binding, rejects old source proofs and preserves another owner',async()=>{
    const f=await fixture();const binding=await linked(f,true);
    const imported=(await f.native('GET','records')).body.data as any;const recordId=imported.items[0].id;
    const otherWrite=await f.native('PUT','records/record-http-bob-retained',write('Bob 的记录保留',0),'user_bob');assert.equal(otherWrite.statusCode,200);
    const proof=await f.application.services.authService.issueReauthenticationProof('lighttick','user_alice','Password1234');
    const deleted=await f.native('DELETE','me/account',{confirmation:'DELETE',reauthentication_token:proof.token});assert.equal(deleted.statusCode,200,JSON.stringify(deleted.body));
    assert.equal((await f.repository.listRecords(OWNER)).length,0);
    assert.equal((await f.repository.recordVersions(OWNER,recordId)).length,0);
    assert.equal(await f.repository.recordSourceHistory(OWNER,recordId),undefined);
    assert.equal(await f.repository.getOwnerRecordTransfer(OWNER),undefined);
    assert.equal((await f.repository.pullChanges(OWNER,0,200)).length,0);
    const oldSource=await f.bridge({action:'status'});assert.ok([403,404].includes(oldSource.statusCode),JSON.stringify(oldSource.body));
    const resurrect=await f.bridge({action:'activate',binding_id:binding.binding_id,operation_id:OPERATION,snapshot_hash:binding.snapshot_hash,freeze_receipt:binding.freeze_receipt});assert.ok([403,404].includes(resurrect.statusCode));
    const oldToken=await f.native('GET','records/export');assert.ok([401,403].includes(oldToken.statusCode));
    const other=await f.native('GET','records/export',undefined,'user_bob');assert.equal(other.statusCode,200);assert.equal((other.body.data as any).records[0].record.raw_text,'Bob 的记录保留');
    assert.ok(!JSON.stringify(other.body.data).includes(PRIVATE_MARKER));
    assert.equal((await f.application.database.findAppUser('app_a','user_alice'))?.status,'ACTIVE');
});
