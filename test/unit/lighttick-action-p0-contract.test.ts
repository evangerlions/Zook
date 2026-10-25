import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {LightTickActionCreateRequestSchema,LightTickActionMutationRequestSchema,LightTickActionScheduleRequestSchema,
 LightTickActionWorkspaceSchema,LightTickActionExecutionSchema,LightTickErrorEnvelopeSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
import {readFileSync} from 'node:fs';
import {actionErrorResponse} from '../../src/modules/lighttick/actions/action.gates.ts';
import {ApplicationError} from '../../src/shared/errors.ts';

const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const create=ajv.compile(LightTickActionCreateRequestSchema),mutate=ajv.compile(LightTickActionMutationRequestSchema),schedule=ajv.compile(LightTickActionScheduleRequestSchema);
test('canonical P0 input schemas cover null/modes, conditional dates and explicit operations',()=>{
 const base={title:'test',period:'day',completion_mode:'check',key:'p0-contract-create'};
 for(const value of [base,{...base,start_date:null,end_date:null},{...base,completion_mode:'time',target_minutes:1,minimum_minutes:null},
  {...base,completion_mode:'content',target:{kind:'article',course:'article-p0'}}])assert.equal(create(value),true,JSON.stringify(create.errors));
 for(const value of [{...base,unknown:true},{...base,start_date:'2026-10-19'},
  {...base,period:'week',start_date:null,end_date:null},{...base,completion_mode:'time',target_minutes:null},
  {...base,completion_mode:'time',target_minutes:1.5},{...base,reminder:true},
  {...base,target_count:2},{...base,completion_mode:'content',target:{kind:'article'}},
  {...base,completion_mode:'content',target:{kind:'plan',plan_id:'plan-p0'}},
  {...base,completion_mode:'content',target:null},{...base,completion_mode:'content',target:{kind:'book'}}])
  assert.equal(create(value),false,JSON.stringify(value));
 assert.equal(schedule({title:'content',date:null,target:{kind:'article',course:'article-p0'},key:'p0-schedule'}),true);
 assert.equal(schedule({title:'content',date:null,target:{kind:'book'},key:'p0-schedule'}),false);
 assert.equal(mutate({key:'p0-operation',revision:1,action:'reschedule'}),false);
 assert.equal(mutate({key:'p0-operation',revision:1,action:'reschedule',date:null}),true);
 for(const action of ['complete-time','reopen','cancel','reconcile-content'])assert.equal(mutate({key:'p0-operation',revision:1,action}),true);
});
test('stable P0 errors preserve only safe recovery metadata in the Zook envelope',()=>{
 const validate=ajv.compile(LightTickErrorEnvelopeSchema);
 const response=actionErrorResponse(new ApplicationError(409,'DUPLICATE_SCHEDULE','Existing source date',
  {existing_plan_id:'action-p0-owner-only',private_note:'MUST_NOT_LEAK'}),'p0-error-fixture')!;
 assert.equal(validate(response.body),true,JSON.stringify(validate.errors));
 assert.equal((response.body.data as any).existing_plan_id,'action-p0-owner-only');
 assert.equal(JSON.stringify(response.body).includes('MUST_NOT_LEAK'),false);
});
test('canonical output fixtures include nullable schedules and v2 facts without private inventory',()=>{
 const workspace=ajv.compile(LightTickActionWorkspaceSchema),execution=ajv.compile(LightTickActionExecutionSchema);
 for(const file of ['action-workspace-success.json','action-workspace-running.json','action-workspace-p0-v2.json']){
  const result=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/'+file,import.meta.url),'utf8'));
  assert.equal(workspace(result.data),true,JSON.stringify(workspace.errors));
  assert.equal(result.data.capabilities.connection_write_enabled,false);
  assert.equal(result.data.content_events,undefined);assert.equal(result.data.content_sources,undefined);
 }
 const records=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/action-records-p0-v2.json',import.meta.url),'utf8'));
 for(const record of records.records)assert.equal(execution(record),true,JSON.stringify(execution.errors));
 const reversal=records.records.find((r:any)=>r.record_kind==='reversal');assert.ok(reversal.reverses_record_id);
 const content=records.records.find((r:any)=>r.record_kind==='completion'&&r.completion_mode==='content');
 assert.ok(content.source_event_id);assert.equal(execution({...content,actual_minutes:20}),false);
 const {source_event_id,...noEvent}=content;assert.equal(execution(noEvent),false);
});
