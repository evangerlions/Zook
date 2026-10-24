import test from 'node:test';import assert from 'node:assert/strict';import {createHmac} from 'node:crypto';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';import {canonical,digest} from '../../src/modules/lighttick/actions/action.validation.ts';
const owner={appId:'lighttick',userId:'link-owner'} as const,secret='TEST_ONLY_BRIDGE_SECRET_01234567890123456789';
const snapshot={plans:[],records:[],reviews:[],reports:[],operations:[],claims:[]};
test('two-account pairing, exact idempotent import receipt and no double writer',async()=>{
 const r=new InMemoryLightTickRepository(),actions=new ActionService(r),links=new ActionLinkService(actions,secret),t=await links.ticket(owner);
 assert.equal((await links.preview(t.code,'grow-alice')).target_user_id,owner.userId);
 const binding=await links.claim(t.code,'grow-alice');await assert.rejects(links.claim(t.code,'grow-bob'),/其他账号/);
 const request={snapshot,snapshot_hash:digest(snapshot)};const receipt=await links.import('grow-alice',request);assert.equal(receipt.binding_id,binding.binding_id);assert.deepEqual(await links.import('grow-alice',request),receipt);
 await assert.rejects(links.import('grow-alice',{snapshot:{...snapshot,extra:'changed'},snapshot_hash:digest({...snapshot,extra:'changed'})}),/禁止覆盖/);
 const body={action:'request',method:'GET',path:''},source='grow-alice',timestamp=String(Math.floor(Date.now()/1000)),nonce='test-request-unique-123';
 const signature=createHmac('sha256',secret).update([source,timestamp,nonce,canonical(body)].join('\n')).digest('hex');links.verify(source,timestamp,nonce,signature,body);
 assert.throws(()=>links.verify('grow-bob',timestamp,nonce,signature,body),/签名/);assert.throws(()=>links.verify(source,'1000000000',nonce,signature,body),/过期/);
});
test('expired/replaced code, source collisions and invalid import roll back',async()=>{
 const actions=new ActionService(new InMemoryLightTickRepository()),links=new ActionLinkService(actions,secret),first=await links.ticket(owner),fresh=await links.ticket(owner);
 await assert.rejects(links.claim(first.code,'grow-alice'),/已更新/);await links.claim(fresh.code,'grow-alice');
 const expired=new ActionLinkService(actions,secret,()=>new Date(Date.now()+600000));await assert.rejects(expired.preview(fresh.code,'grow-alice'),/过期/);
 const other={...owner,userId:'other'},t=await links.ticket(other);await assert.rejects(links.claim(t.code,'grow-alice'),/已连接/);
 await assert.rejects(links.import('grow-alice',{snapshot,snapshot_hash:'x'.repeat(64)}),/校验/);assert.equal((await links.linked('grow-alice')).phase,'staged');
});
