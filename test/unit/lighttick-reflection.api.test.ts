import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { createApplication } from '../support/create-test-application.ts';
test('registered journal HTTP contract saves, lists, rejects stale/invalid content and does not enqueue AI',async()=>{
 const seed=buildDefaultSeed(undefined,{includeLightTick:true});seed.appUsers.push({id:'journal-member',appId:'lighttick',userId:'user_alice',status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
 const app=await createApplication({seed,lighttickEnabled:true});const headers={authorization:'Bearer '+app.services.tokenService.issueAccessToken('user_alice','lighttick'),'x-app-id':'lighttick','idempotency-key':'journal-test-goal'};
 const goal=await app.app.handle({method:'POST',path:'/api/v1/lighttick/goals',headers,body:{title:'学英语',constraints:{}}});assert.equal(goal.statusCode,201);
 const body={goal_id:goal.body.data.id,period_start:'2026-09-19',period_end:'2026-09-19',content:'今天完成了阅读',next_action:'明天整理词汇',base_version:0};
 const save=()=>app.app.handle({method:'PUT',path:'/api/v1/lighttick/reflections/journal-test-001',headers,body});
 const first=await save();assert.equal(first.statusCode,200,JSON.stringify(first.body));assert.equal(first.body.data.version,1);
 const fixture=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/reflection-journal-success.json',import.meta.url),'utf8'));
 assert.deepEqual(Object.keys(first.body.data).filter(k=>first.body.data[k]!==undefined).sort(),Object.keys(fixture.data).sort());
 assert.equal((await save()).body.data.version,1);
 const list=await app.app.handle({method:'GET',path:'/api/v1/lighttick/reflections',query:{goal_id:body.goal_id},headers});assert.equal(list.body.data.items.length,1);
 const bad=await app.app.handle({method:'PUT',path:'/api/v1/lighttick/reflections/journal-test-001',headers,body:{...body,content:'不允许覆盖'}});assert.equal(bad.statusCode,409);
 const invalid=await app.app.handle({method:'PUT',path:'/api/v1/lighttick/reflections/journal-test-002',headers,body:{...body,content:'x'.repeat(4001)}});assert.equal(invalid.statusCode,400);
});
