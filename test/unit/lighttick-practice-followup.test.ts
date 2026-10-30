import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {fieldNames} from '../../src/modules/lighttick/actions/action.validation.ts';
const owner={appId:'lighttick' as const,userId:'followup-owner'},now=()=>new Date('2026-10-30T10:00:00Z');
async function setup(){
 const repo=new InMemoryLightTickRepository(),actions=new ActionService(repo,now,undefined,true),records=new LightTickRecordService(repo,now);
 const record=await records.mutate(owner,'record-followup-source','save',{raw_text:'Private source',record_date:'2026-10-30',base_version:0},'source-create-key');
 let p=(await actions.request(owner,'POST','/practices',{key:'practice-create-key',title:'Original practice',source_kind:'record',source_id:record.id,source_version:'1',date:null}) as any).plan;
 p=(await actions.request(owner,'POST',`/${p.id}/operations`,{key:'feedback-create-key',revision:p.revision,action:'practice-feedback',feedback:{outcome:'unknown',result:'Tried it',next_step:'Ask a colleague'}}) as any).plan;
 const parent=(await actions.request(owner,'POST','',{key:'parent-create-key',title:'Next week',period:'week',start_date:'2026-11-02',end_date:'2026-11-08',timezone:'Asia/Shanghai',target_minutes:60}) as any).plans[0];
 const path='/practices/'+p.id+'/follow-up',body={key:'followup-create-key',revision:p.revision,feedback_id:p.practice_feedback[0].id,source_version:'1',title:'Ask one colleague',date:'2026-11-03',timezone:'Asia/Shanghai',parent_id:parent.id,parent_revision:parent.revision};
 return {repo,actions,records,record,p,parent,path,body};
}
test('reviewed follow-up preserves feedback origin and current parent without automatic completion or budget reset',async()=>{
 const {repo,actions,p,parent,path,body}=await setup();
 assert.equal((await actions.readWorkspace(owner)).data.plans.length,2);
 const context=await actions.request(owner,'GET',path,{}, {feedback_id:body.feedback_id}) as any;
 assert.equal(context.available,true);assert.equal(context.feedback.next_step,'Ask a colleague');assert.equal(context.parents[0].target_minutes,60);
 const result=await actions.request(owner,'POST',path,body) as any;
 assert.deepEqual(result.plan.practice_origin,{plan_id:p.id,feedback_id:body.feedback_id});assert.equal(result.plan.completion_mode,'check');assert.equal(result.plan.start_date,'2026-11-03');
 assert.equal(result.plan.parent_id,parent.id);assert.equal(result.plan.practice_source.id,'record-followup-source');
 assert.deepEqual(await actions.request(owner,'POST',path,body),result);
 const w=(await actions.readWorkspace(owner)).data;
 assert.equal(w.records.length,0);assert.equal(w.plans.length,3);assert.equal(w.plans.find(x=>x.id===parent.id)!.target_minutes,60);assert.equal(w.plans.find(x=>x.id===parent.id)!.revision,1);
 assert.equal(w.plans.find(x=>x.id===p.id)!.status,'active');assert.equal(w.plans.find(x=>x.id===p.id)!.practice_feedback!.length,1);
 assert.equal((await repo.getRecord(owner,'record-followup-source'))!.payload.raw_text,'Private source');
});
test('follow-up rejects stale source, parent, origin and other owner; committed retry survives source archive',async()=>{
 const {actions,records,record,p,parent,path,body}=await setup();
 await assert.rejects(actions.request({...owner,userId:'other'},'POST',path,body));
 await assert.rejects(actions.request(owner,'POST',path,{...body,feedback_id:'feedback-missing'}));
 await actions.request(owner,'POST',`/${parent.id}/operations`,{key:'parent-reduce-key',revision:1,action:'edit',fields:{...Object.fromEntries(fieldNames.map(k=>[k,parent[k]])),target_minutes:30}});
 await assert.rejects(actions.request(owner,'POST',path,body));
 const result=await actions.request(owner,'POST',path,{...body,parent_revision:2}) as any;
 await records.mutate(owner,record.id,'archive',{base_version:1},'source-archive-key');
 assert.deepEqual(await actions.request(owner,'POST',path,{...body,parent_revision:2}),result);
 await assert.rejects(actions.request(owner,'POST',path,{...body,key:'new-source-command',parent_revision:2}));
 assert.equal((await actions.readWorkspace(owner)).data.plans.find(x=>x.id===parent.id)!.target_minutes,30);
 await actions.request(owner,'POST',`/${p.id}/operations`,{key:'next-feedback-key',revision:p.revision,action:'practice-feedback',feedback:{outcome:'not_applied',result:'Needs a smaller attempt'}});
 await assert.rejects(actions.request(owner,'POST',path,{...body,key:'stale-origin-command',parent_revision:2}));
});

import {readFileSync} from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {LightTickActionWorkspaceSchema,LightTickPracticeFollowUpContextEnvelopeSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
test('canonical follow-up wire fixture and live context validate with source availability and parent revisions',async()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
 const fixture=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/practice-followup-workspace-success.json',import.meta.url),'utf8'));
 const validate=ajv.compile(LightTickActionWorkspaceSchema);assert.equal(validate(fixture.data),true,JSON.stringify(validate.errors));
 const {actions,path,body}=await setup(),context=await actions.request(owner,'GET',path,{}, {feedback_id:body.feedback_id});
 const check=ajv.compile(LightTickPracticeFollowUpContextEnvelopeSchema);assert.equal(check({code:'OK',message:'ok',requestId:'synthetic',data:context}),true,JSON.stringify(check.errors));
});
