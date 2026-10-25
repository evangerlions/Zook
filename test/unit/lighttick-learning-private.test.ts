import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {receiveLibrary} from '../../src/modules/lighttick/learning/learning-library.ts';
import {exchangePrivate,privateLearning} from '../../src/modules/lighttick/learning/learning-private.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
test('private scope preserves source ownership, optimistic versions and durable command receipts',async()=>{
 const repo=new InMemoryLightTickRepository(),a=new ActionService(repo,()=>new Date('2026-10-25T12:00:00Z'));
 const link={appId:'lighttick',userId:'alice',source_account_id:'source-a',binding_id:'bind-a',phase:'staged'} as const;await repo.saveActionLink(link);
 const lesson={id:'lesson-private',collection_id:'yingyu',collection_title:'English',number:1,title:'Read',content:'Read',references:'',learning_state:'unknown',source_url:'https://grow.example/',content_version:digest({content:'Read',references:''})};
 const library={action:'learning-library',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:'2026-10-25T12:00:00Z',consent_enabled:true,lessons:[lesson]};await receiveLibrary(a,link,library);
 assert.equal((await privateLearning(a,link,lesson.id)).enabled,false);
 const state={id:lesson.id,content_version:lesson.content_version,draft_version:lesson.content_version,revision:1,notes:'From H5',answers:[{id:'exercise:1',prompt:'Why?',answer:'Because'}],questions:[{id:'exercise:1',prompt:'Why?',answer:''}],completed:false,completed_at:null,position:2,updated_at:'2026-10-25T12:00:00Z'};
 const exchange={action:'learning-private',action_schema_version:2,binding_id:link.binding_id,source_revision:1,enabled:true,lessons:[state],results:[]};await exchangePrivate(a,link,exchange);
 const command={id:'request-private-1',content_version:lesson.content_version,revision:1,action:'save',notes:'On phone',answers:state.answers,position:3};
 const queued=await privateLearning(a,link,lesson.id,command);assert.equal(queued.state.notes,'From H5');assert.equal(queued.operations[0].status,'pending');
 await privateLearning(a,link,lesson.id,command);assert.equal((await exchangePrivate(a,link,exchange)).requests.length,1);
 await assert.rejects(privateLearning(a,link,lesson.id,{...command,notes:'tamper'}));
 await exchangePrivate(a,link,{...exchange,source_revision:2,lessons:[{...state,revision:2,notes:'On phone'}],results:[{id:command.id,status:'applied',error:''}]});
 const accepted=await privateLearning(a,link,lesson.id,command);assert.equal(accepted.state.notes,'On phone');assert.equal(accepted.operations[0].status,'applied');
 await assert.rejects(privateLearning(a,link,lesson.id,{...command,id:'request-private-2'}));await assert.rejects(privateLearning(a,{appId:'lighttick',userId:'bob'},lesson.id));
 assert.equal((await a.readWorkspace(link)).data.records.length,0);
 await receiveLibrary(a,link,{...library,source_revision:2,consent_enabled:false,lessons:[]});await assert.rejects(privateLearning(a,link,lesson.id));assert.equal((await repo.getLearningPrivate(link))!.lessons.length,0);
 await repo.deleteOwnerData(link);assert.equal(await repo.getLearningPrivate(link),undefined);
});

import Ajv2020 from 'ajv/dist/2020.js';import {readFileSync} from 'node:fs';import addFormats from 'ajv-formats';
import {LightTickLearningPrivateEnvelopeSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
test('private fixture retains unknown legacy completion time and stable question identity',()=>{const ajv=new Ajv2020({strict:false});addFormats(ajv);const value=JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/learning-private-success.json',import.meta.url),'utf8'));const valid=ajv.compile(LightTickLearningPrivateEnvelopeSchema);assert.equal(valid(value),true,JSON.stringify(valid.errors));assert.equal(value.data.state.completed_at,null);assert.equal(value.data.state.answers[0].id,value.data.state.questions[0].id);});
