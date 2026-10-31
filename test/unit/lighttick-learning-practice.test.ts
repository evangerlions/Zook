import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {receiveLibrary} from '../../src/modules/lighttick/learning/learning-library.ts';
import {digest,fieldNames} from '../../src/modules/lighttick/actions/action.validation.ts';
const owner={appId:'lighttick',userId:'alice'} as const,now=()=>new Date('2026-10-29T12:00:00Z');
async function setup(){
 const repo=new InMemoryLightTickRepository(),actions=new ActionService(repo,now,undefined,true);
 const link={...owner,source_account_id:'grow-alice',binding_id:'practice-binding',phase:'active'} as const;
 await repo.saveActionLink(link);
 const lesson={id:'lesson-practice',collection_id:'yingyu',collection_title:'Private collection',number:1,title:'Private lesson title',content:'Secret course body',references:'',learning_state:'completed',source_url:'https://grow.example/#mobile/learn/lesson-practice',content_version:digest({content:'Secret course body',references:''})};
 const library={action:'learning-library',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:now().toISOString(),consent_enabled:true,lessons:[lesson]};
 await receiveLibrary(actions,link,library);
 const body={key:'practice-create-1',title:'Rewrite a real report',source_kind:'lesson',source_id:lesson.id,source_version:lesson.content_version,date:null,timezone:'Asia/Shanghai'};
 return {repo,actions,link,lesson,library,body};
}
test('reviewed practice is an unscheduled independent check action; immutable source holds no copied private content',async()=>{
 const {repo,actions,link,lesson,body}=await setup();
 const {plan}=await actions.request(owner,'POST','/practices',body) as any;
 assert.equal(plan.completion_mode,'check');assert.equal(plan.start_date,null);assert.equal(plan.target,null);
 assert.deepEqual(plan.practice_source,{kind:'lesson',id:lesson.id,version:lesson.content_version,binding_id:link.binding_id});
 assert.equal(JSON.stringify(plan).includes('Secret course body'),false);assert.equal(JSON.stringify(plan).includes('Private lesson title'),false);
 assert.equal((await actions.readWorkspace(owner)).data.records.length,0);
 assert.equal((await repo.getLearningLibrary(owner))!.lessons[0].learning_state,'completed');
 assert.equal((await actions.request(owner,'GET','/practices',{}, {source_id:lesson.id,source_kind:'lesson'}) as any).practices[0].id,plan.id);
 assert.equal((await actions.request({...owner,userId:'bob'},'GET','/practices') as any).practices.length,0);
 await assert.rejects(actions.request(owner,'POST',`/${plan.id}/operations`,{key:'practice-mode-change',revision:1,action:'edit',fields:{...Object.fromEntries(fieldNames.map(k=>[k,plan[k]])),completion_mode:'content',target:{kind:'plan',plan_id:'plan-x',lesson_no:1}}}));
});
test('feedback is append-only, versioned, replayable and independent of completion and next-action creation',async()=>{
 const {actions,body}=await setup();let p=(await actions.request(owner,'POST','/practices',{...body,date:'2026-10-29'}) as any).plan;
 const feedback={key:'practice-feedback-1',revision:p.revision,action:'practice-feedback',feedback:{outcome:'unknown',result:'Tried it',evidence:'Colleague feedback pending',next_step:'Ask tomorrow'}};
 p=(await actions.request(owner,'POST',`/${p.id}/operations`,feedback) as any).plan;
 assert.equal(p.status,'active');assert.equal(p.practice_feedback.length,1);
 assert.equal((await actions.readWorkspace(owner)).data.records.length,0);assert.equal((await actions.readWorkspace(owner)).data.plans.length,1);
 assert.deepEqual((await actions.request(owner,'POST',`/${p.id}/operations`,feedback) as any).plan,p);
 await assert.rejects(actions.request(owner,'POST',`/${p.id}/operations`,{...feedback,key:'practice-feedback-stale'}));
 p=(await actions.request(owner,'POST',`/${p.id}/operations`,{key:'practice-confirm-1',revision:p.revision,action:'complete'}) as any).plan;
 p=(await actions.request(owner,'POST',`/${p.id}/operations`,{...feedback,key:'practice-feedback-2',revision:p.revision,feedback:{outcome:'applied',result:'Report understood',evidence:'Meeting notes',next_step:''}}) as any).plan;
 assert.equal(p.status,'completed');assert.equal(p.practice_feedback.length,2);assert.equal(p.practice_feedback[0].outcome,'unknown');
 assert.equal((await actions.readWorkspace(owner)).data.records.length,1);
});
test('new commands reject changed/revoked/foreign sources while committed identical retries survive withdrawal',async()=>{
 const {actions,repo,link,library,body}=await setup();
 await assert.rejects(actions.request(owner,'POST','/practices',{...body,source_version:'f'.repeat(64)}));
 await assert.rejects(actions.request({...owner,userId:'bob'},'POST','/practices',body));
 const result=await actions.request(owner,'POST','/practices',body) as any;
 assert.equal((await actions.request(owner,'GET',`/practices/${result.plan.id}/source`) as any).available,true);
 await receiveLibrary(actions,link,{...library,source_revision:2,consent_enabled:false,lessons:[]});
 assert.deepEqual(await actions.request(owner,'POST','/practices',body),result);
 assert.equal((await actions.request(owner,'GET',`/practices/${result.plan.id}/source`) as any).available,false);
 await assert.rejects(actions.request(owner,'POST','/practices',{...body,key:'practice-after-revoke'}));
 await assert.rejects(actions.request(owner,'POST','/practices',{...body,title:'different payload'}));
 await repo.deleteOwnerData(owner);assert.equal((await actions.request(owner,'GET','/practices') as any).practices.length,0);
});
test('record sources validate latest version/archive state under record-before-action locks',async()=>{
 const {actions,repo,body}=await setup(),records=new LightTickRecordService(repo,now);
 const r=await records.mutate(owner,'record-practice-1','save',{base_version:0,raw_text:'Secret original record',record_date:'2026-10-29'},'record-create-key');
 const input={...body,source_kind:'record',source_id:r.id,source_version:String(r.version)};
 const order:string[]=[];const recordLock=repo.lockRecordOwner.bind(repo),actionLock=repo.lockActionOwner.bind(repo);
 repo.lockRecordOwner=async o=>{order.push('record');await recordLock(o)};repo.lockActionOwner=async o=>{order.push('action');await actionLock(o)};
 const result=await actions.request(owner,'POST','/practices',input) as any;
 assert.deepEqual(order.slice(0,2),['record','action']);assert.equal(JSON.stringify(result).includes(r.raw_text),false);
 await records.mutate(owner,r.id,'archive',{base_version:r.version},'record-archive-key');
 await assert.rejects(actions.request(owner,'POST','/practices',{...input,key:'record-practice-after-archive'}));
 assert.deepEqual(await actions.request(owner,'POST','/practices',input),result);
});
test('reading-only binding cannot silently switch local action authority',async()=>{
 const {actions,repo,link,body}=await setup();await repo.saveActionLink({...link,phase:'staged'});
 await assert.rejects(actions.request(owner,'POST','/practices',body));
 assert.equal((await actions.readWorkspace(owner)).data.plans.length,0);
});

import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {LightTickActionWorkspaceSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
test('canonical practice fixture validates enabled capabilities, source references and independent feedback',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);const fixture=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/practice-workspace-success.json',import.meta.url),'utf8'));
 const validate=ajv.compile(LightTickActionWorkspaceSchema);assert.equal(validate(fixture.data),true,JSON.stringify(validate.errors));assert.equal(fixture.data.plans[0].status,'active');assert.equal(fixture.data.plans[0].practice_feedback.length,1);
});
