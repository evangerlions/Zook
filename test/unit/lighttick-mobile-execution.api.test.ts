import test from 'node:test';
import assert from 'node:assert/strict';
import {createApplication} from '../support/create-test-application.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';

test('opt-in native v2 execution preserves modes, rejects old writers and isolates owners',async()=>{
 const names=['LIGHTTICK_ACTIONS_ENABLED','LIGHTTICK_ACTIONS_V2_ENABLED','GROW_ACTION_BRIDGE_SECRET'];
 const saved=names.map(n=>process.env[n]);process.env.LIGHTTICK_ACTIONS_ENABLED='1';process.env.LIGHTTICK_ACTIONS_V2_ENABLED='1';process.env.GROW_ACTION_BRIDGE_SECRET='synthetic-mobile-execution-secret-1234567890';
 try {
  const seed=buildDefaultSeed(undefined,{includeLightTick:true});
  for(const userId of ['user_alice','user_bob'])seed.appUsers.push({id:'mobile-'+userId,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
  const app=await createApplication({seed,lighttickEnabled:true}),prefix='/api/v1/lighttick/action-plans';
  const headers={authorization:'Bearer '+app.services.tokenService.issueAccessToken('user_alice','lighttick'),'x-app-id':'lighttick','x-grow-action-schema':'2'};
  const call=(method:string,path='',body?:unknown,h=headers)=>app.app.handle({method,path:prefix+path,headers:h,body});
  const caps=(await call('GET')).body.data as any;assert.equal(caps.capabilities.connection_write_enabled,true);assert.deepEqual(caps.capabilities.completion_modes,['time','content','check']);
  const day=new Date().toISOString().slice(0,10),body={key:'mobile-create-check',title:'本人勾选',period:'day',completion_mode:'check',start_date:day,end_date:day,timezone:'UTC'};
  assert.equal((await call('POST','',body,{...headers,'x-grow-action-schema':'1'})).body.code,'CONTRACT_UPGRADE_REQUIRED');
  const created=await call('POST','',body);assert.equal(created.statusCode,200);const p=(created.body.data as any).plans[0];assert.equal(p.target_minutes,null);
  const done={key:'mobile-complete-check',revision:1,action:'complete'};const first=await call('POST','/'+p.id+'/operations',done);assert.equal(first.statusCode,200);assert.deepEqual((await call('POST','/'+p.id+'/operations',done)).body.data,first.body.data);
  const reopened=await call('POST','/'+p.id+'/operations',{key:'mobile-reopen-check',revision:2,action:'reopen'});assert.equal(reopened.statusCode,200);
  const records=(await call('GET','/records')).body.data as any;assert.deepEqual(new Set(records.records.map((r:any)=>r.record_kind)),new Set(['completion','reversal']));
  const other={...headers,authorization:'Bearer '+app.services.tokenService.issueAccessToken('user_bob','lighttick')};assert.equal(((await call('GET','',undefined,other)).body.data as any).plans.length,0);
  const ticket=await app.app.handle({method:'POST',path:'/api/v1/lighttick/action-link-tickets',headers,body:{}});assert.equal(ticket.statusCode,200);
 }finally {names.forEach((n,i)=>saved[i]===undefined?delete process.env[n]:process.env[n]=saved[i]);}
});
