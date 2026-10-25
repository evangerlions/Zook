import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {receiveLibrary,readLibrary} from '../../src/modules/lighttick/learning/learning-library.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
test('reading is separately consented, bound, versioned, private and read-only; revoke and delete clear it',async()=>{
 const repo=new InMemoryLightTickRepository(),actions=new ActionService(repo,()=>new Date('2026-10-25T12:00:00Z'));
 const link={appId:'lighttick',userId:'alice',source_account_id:'grow-a',binding_id:'binding-a',phase:'active'} as const;await repo.saveActionLink(link);
 const lesson={id:'lesson-abcdef',collection_id:'yingyu',collection_title:'英文阅读',number:1,title:'Day001',content:'# Course\n\nRead it.',references:'https://example.org',learning_state:'unknown',source_url:'https://grow.example/#mobile/learn/lesson-abcdef',content_version:''};lesson.content_version=digest({content:lesson.content,references:lesson.references});
 const body={action:'learning-library',action_schema_version:2,binding_id:link.binding_id,source_revision:1,observed_at:'2026-10-25T12:00:00Z',consent_enabled:true,lessons:[lesson]};
 assert.equal((await readLibrary(actions,link)).consent_enabled,false);
 const receipt=await receiveLibrary(actions,link,body);assert.deepEqual(await receiveLibrary(actions,link,body),receipt);
 const index=await readLibrary(actions,link);assert.equal(index.lessons.length,1);assert.equal(index.lessons[0].content,undefined);
 assert.equal((await readLibrary(actions,link,lesson.id)).lesson.content,lesson.content);assert.equal((await readLibrary(actions,{...link,userId:'bob'})).lessons.length,0);
 assert.equal((await actions.readWorkspace(link)).data.records.length,0);
 await assert.rejects(receiveLibrary(actions,link,{...body,binding_id:'bad'}));await assert.rejects(receiveLibrary(actions,link,{...body,source_revision:2,lessons:[{...lesson,private_note:'no'}]}));
 await assert.rejects(receiveLibrary(actions,link,{...body,source_revision:2,lessons:[{...lesson,content:'changed'}]}));
 await assert.rejects(receiveLibrary(actions,link,{...body,source_revision:2,lessons:[{...lesson,source_url:'https://secret@grow.example/'}]}));
 await receiveLibrary(actions,link,{...body,source_revision:2,consent_enabled:false,lessons:[]});assert.equal((await readLibrary(actions,link)).consent_enabled,false);await assert.rejects(readLibrary(actions,link,lesson.id));
 await assert.rejects(receiveLibrary(actions,link,body));await repo.deleteOwnerData(link);assert.equal(await repo.getLearningLibrary(link),undefined);
});

import Ajv2020 from 'ajv/dist/2020.js';import addFormats from 'ajv-formats';import {readFileSync} from 'node:fs';
import {LightTickLearningLibraryEnvelopeSchema,LightTickLearningLessonEnvelopeSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
test('canonical reader fixtures validate with all fields and nullable scope',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
 for(const [file,schema] of [['learning-library-success.json',LightTickLearningLibraryEnvelopeSchema],['learning-lesson-sample-1.json',LightTickLearningLessonEnvelopeSchema],['learning-lesson-sample-2.json',LightTickLearningLessonEnvelopeSchema]] as const){const validate=ajv.compile(schema);assert.equal(validate(JSON.parse(readFileSync(new URL('../../api-contracts/fixtures/lighttick/'+file,import.meta.url),'utf8'))),true,JSON.stringify(validate.errors));}
});
