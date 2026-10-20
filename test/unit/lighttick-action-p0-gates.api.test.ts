import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createApplication} from '../support/create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {canonical} from '../../src/modules/lighttick/actions/action.validation.ts';

test('registered API and signed bridge remain closed independently of old enable flag and schema2',async()=>{
 const previous=process.env.LIGHTTICK_ACTIONS_ENABLED,secret=process.env.GROW_ACTION_BRIDGE_SECRET;
 process.env.LIGHTTICK_ACTIONS_ENABLED='1';process.env.GROW_ACTION_BRIDGE_SECRET='TEST_ONLY_P0_SECRET_01234567890123456789';
 try{
  const seed=buildDefaultSeed(undefined,{includeLightTick:true});
  seed.appUsers.push({id:'p0-alice-member',appId:'lighttick',userId:'user_alice',status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
  const runtime=await createApplication({seed,lighttickEnabled:true}),path='/api/v1/lighttick/action-plans';
  const headers={authorization:'Bearer '+runtime.services.tokenService.issueAccessToken('user_alice','lighttick'),'x-app-id':'lighttick'};
  const call=(suffix:string,body:unknown={},extra={})=>runtime.app.handle({method:'POST',path:suffix.startsWith('/api/')?suffix:path+suffix,headers:{...headers,...extra},body});
  assert.equal((await runtime.app.handle({method:'POST',path,headers:{},body:null})).statusCode,401);
  for(const suffix of ['','/schedules','/action-fake/operations','/reviews','/reviews/generate','/action-fake/reminder-claim','/api/v1/lighttick/action-link-tickets']){
   const missing=await call(suffix);assert.equal(missing.body.code,'CONTRACT_UPGRADE_REQUIRED');
   for(const version of ['1','2','3']){
    const response=await call(suffix,{key:'p0-api-no-write'},{'x-grow-action-schema':version});
    assert.equal(response.statusCode,409);assert.equal(response.body.code,'CONTRACT_UPGRADE_REQUIRED');
    assert.equal((response.body.data as any).reason,version==='2'?'CONNECTION_WRITES_DISABLED':'CONTRACT_SCHEMA_VERSION');
    assert.equal((response.body.data as any).retryable,false);
   }
  }
  const core=runtime.services.lighttickRuntime!,owner={appId:'lighttick',userId:'user_alice'} as const;
  assert.equal((await core.actions.request(owner,'GET','') as any).plans.length,0);
  const ticket=await core.actionLinks.ticket(owner);await core.actionLinks.claim(ticket.code,'p0-source');
  await core.actions.repository.saveActionLink({...await core.actionLinks.linked('p0-source'),phase:'active'});
  const bridge=async(body:any)=>{
   const stamp=String(Math.floor(Date.now()/1000)),nonce='p0-request-unique-123456789';
   const signature=createHmac('sha256',process.env.GROW_ACTION_BRIDGE_SECRET!).update(['p0-source',stamp,nonce,canonical(body)].join('\n')).digest('hex');
   return runtime.app.handle({method:'POST',path:'/api/v1/lighttick/grow-bridge',headers:{'x-grow-account-id':'p0-source','x-grow-timestamp':stamp,'x-grow-nonce':nonce,'x-grow-signature':signature},body});
  };
  for(const body of [{action:'request',method:'POST',path:'',body:{},query:{},action_schema_version:2},
   {action:'claim',code:ticket.code},{action:'import',snapshot:{},snapshot_hash:'0'.repeat(64)}]){
   const response=await bridge(body);assert.equal(response.statusCode,409);assert.equal((response.body.data as any).reason,'CONNECTION_WRITES_DISABLED');
  }
  const read=await bridge({action:'request',method:'GET',path:'',body:{},query:{}});
  assert.equal(read.statusCode,200);assert.equal((read.body.data as any).capabilities.connection_write_enabled,false);
  assert.deepEqual((read.body.data as any).capabilities.content_receipts,[]);
  assert.equal((await core.actions.request(owner,'GET','') as any).plans.length,0);
 }finally{
  if(previous===undefined)delete process.env.LIGHTTICK_ACTIONS_ENABLED;else process.env.LIGHTTICK_ACTIONS_ENABLED=previous;
  if(secret===undefined)delete process.env.GROW_ACTION_BRIDGE_SECRET;else process.env.GROW_ACTION_BRIDGE_SECRET=secret;
 }
});
