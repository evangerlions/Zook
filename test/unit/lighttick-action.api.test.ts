import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';
import {LightTickActionWorkspaceSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
import {createApplication} from '../support/create-test-application.ts';import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
test('action API authenticates, isolates accounts and matches populated canonical workspace fixtures',async()=>{
 const previous=process.env.LIGHTTICK_ACTIONS_ENABLED;process.env.LIGHTTICK_ACTIONS_ENABLED='1';
 try{
  const seed=buildDefaultSeed(undefined,{includeLightTick:true});for(const userId of ['user_alice','user_bob'])seed.appUsers.push({id:'actions-'+userId,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
  const runtime=await createApplication({seed,lighttickEnabled:true});
  const call=(user:string,method='GET',body?:unknown)=>runtime.app.handle({method,path:'/api/v1/lighttick/action-plans',headers:user?{authorization:'Bearer '+runtime.services.tokenService.issueAccessToken(user,'lighttick'),'x-app-id':'lighttick'}:{},body});
  assert.equal((await call('')).statusCode,401);
  const created=await call('user_alice','POST',{key:'api-create-action',title:'读书',period:'day',start_date:'2026-10-20',end_date:'2026-10-20'});assert.equal(created.statusCode,409);
  assert.equal(created.body.code,'CONTRACT_UPGRADE_REQUIRED');
  await runtime.services.lighttickRuntime!.actions.request({appId:'lighttick',userId:'user_alice'},'POST','',
   {key:'internal-fixture-create',title:'P0 fixture',period:'day',completion_mode:'check',start_date:null,end_date:null});
  const ajv=new Ajv2020({strict:false});addFormats(ajv);const validate=ajv.compile(LightTickActionWorkspaceSchema);
  const snapshot=await call('user_alice');assert.equal(validate(JSON.parse(JSON.stringify(snapshot.body.data))),true,JSON.stringify(validate.errors));
  for(const file of ['action-workspace-success.json','action-workspace-running.json']){const fixture=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/'+file,import.meta.url),'utf8'));assert.equal(validate(fixture.data),true,JSON.stringify(validate.errors));}
  assert.deepEqual((await call('user_bob')).body.data.plans,[]);
  runtime.services.lighttickRuntime!.actionsEnabled=false;assert.equal((await call('user_alice')).statusCode,503);
 }finally{if(previous===undefined)delete process.env.LIGHTTICK_ACTIONS_ENABLED;else process.env.LIGHTTICK_ACTIONS_ENABLED=previous;}
});
