import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {InMemoryNativeLearningStore} from '../../src/testing/in-memory-native-learning-store.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {NativeLearningService} from '../../src/modules/lighttick/learning/native-learning.service.ts';
import {LearningContentSyncService} from '../../src/modules/lighttick/learning/content-sync.service.ts';
import {ContentPublicationService} from '../../src/modules/lighttick/learning/content-publication.service.ts';
import {ContentDeduplicationService} from '../../src/modules/lighttick/learning/content-deduplication.service.ts';
import {LightTickGoalWorkspaceSnapshotSchema,LightTickEvidenceSnapshotSchema,LightTickEvidenceFeedbackSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
import type {LearningModule,UserSubscription} from '../../src/modules/lighttick/learning/native-learning.types.ts';
const owner={appId:'lighttick' as const,userId:'checks-alice'},other={...owner,userId:'checks-bob'},now='2026-11-17T12:00:00.000Z';
const module:LearningModule={...owner,id:'module-checks',title:'工作汇报',description:'',enabled:true,sourceType:'github',sourceUrl:null,sourcePath:null,revision:1,createdAt:now,updatedAt:now,sourceConfig:{github:{repository:'test/fixture',branch:'main',prefix:'',syncInterval:'manual'}},storageUsed:1024};
test('native memory capabilities preserve owner isolation, transaction snapshots and cleanup',async()=>{
 const store=new InMemoryNativeLearningStore();const subscription:UserSubscription={userId:owner.userId,planId:'basic',status:'active',currentPeriodStart:now,currentPeriodEnd:now,cancelAtPeriodEnd:false,createdAt:now,updatedAt:now};
 await store.saveUserSubscription(subscription);await store.saveUserStorage({userId:owner.userId,type:'cloud',isDefault:true});await store.saveLearningModule(module,0);
 assert.equal(await store.getUserSubscription(other),undefined);assert.deepEqual(await store.listUserStorage(other),[]);assert.equal((await store.getStorageUsage(owner)).totalUsed,1024);
 const saved=store.snapshot(),storage=(await store.listUserStorage(owner))[0];await store.deleteUserStorage(owner,storage.id!);assert.equal((await store.listUserStorage(owner)).length,0);store.restore(saved);assert.equal((await store.getUserStorage(owner,storage.id!))?.isDefault,true);store.deleteOwner(owner);assert.equal(await store.getUserSubscription(owner),undefined);assert.deepEqual(await store.listUserStorage(owner),[]);
});
test('new private learning state carries the publication module identity',async()=>{
 const repo=new InMemoryLightTickRepository(),native=new NativeLearningService(repo,true);await repo.saveLearningModule(module,0);await native.saveCollection(owner,'collection-checks',{base_revision:0,title:'工作汇报',module_id:module.id,archived:false},'checks-collection');const lesson=await native.publish(owner,'lesson-checks',{base_revision:0,collection_id:'collection-checks',number:1,title:'工作汇报',content:'Practice',references:'',source_url:''},'checks-publication');assert.equal((await native.privateState(owner,lesson.id,lesson.content_version)).moduleId,module.id);
});
test('content synchronization uses its repository and preserves revisions across multiple files',async t=>{
 const store=new InMemoryNativeLearningStore();await store.saveLearningModule(module,0);let commit='commit-one';const files=['lesson-one.md','lesson-two.md'];
 t.mock.method(globalThis,'fetch',async(url:unknown)=>{const path=new URL(String(url)).pathname;if(path.includes('/git/ref/'))return Response.json({object:{sha:commit}});if(path.endsWith('/contents/'))return Response.json(files.map(path=>({path,type:'file',sha:'blob',size:20})));if(path.includes('/contents/lesson-'))return Response.json({sha:'blob',encoding:'utf8',content:'# Work report\nFacts '+commit});throw Error('Unexpected fixture path: '+path);});
 const service=new LearningContentSyncService(store);let result=await service.syncAllModules(owner);assert.equal(result[0].status,'success',result[0].error);assert.equal(result[0].added,2);assert.equal((await store.listLearningCollections(owner,'',20)).length,1);assert.equal((await store.getLearningModule(owner,module.id))?.revision,3);
 commit='commit-two';result=await service.syncAllModules(owner);assert.equal(result[0].status,'success',result[0].error);assert.equal(result[0].updated,2);assert.equal((await store.getNativeLesson(owner,'lesson-one'))?.revision,2);assert.equal((await store.getLearningModule(owner,module.id))?.revision,5);
 assert.deepEqual(await service.syncAllModules(other),[]);
});
test('publication rejects unavailable SQL capability before any external write',async()=>{
 let queried=false,state='';const service=new ContentPublicationService({listLearningModules:async()=>{queried=true;return []}},{getPublication:async()=>undefined,getPublicationByHash:async()=>undefined,savePublication:async()=>{},updatePublicationState:async(_id,s)=>{state=s},listPendingPublications:async()=>[]});
 await assert.rejects(service.publish(owner,module.id,{files:{},sql:[{query:'SELECT 1',params:[]}]}),{statusCode:503,code:'LIGHTTICK_CAPABILITY_UNAVAILABLE'});assert.equal(queried,false);assert.equal(state,'failed');assert.equal(typeof ContentDeduplicationService,'function');
});
test('restored workspace and evidence schemas validate complete responses, rejecting missing fields',()=>{
 const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);const workspace=ajv.compile(LightTickGoalWorkspaceSnapshotSchema),snapshot=ajv.compile(LightTickEvidenceSnapshotSchema),feedback=ajv.compile(LightTickEvidenceFeedbackSchema);
 assert.equal(workspace({workspace_version:1,goals:[]}),true);assert.equal(workspace({goals:[]}),false);const data={id:'snapshot-1',schema_version:1,purpose:'course-summary',stage:'output',captured_at:now,timezone:'Asia/Shanghai',model:'fixture',messages:[{role:'user',content:'practice'}],sources:[],input_hash:'a'.repeat(64)};assert.equal(snapshot(data),true,JSON.stringify(snapshot.errors));assert.equal(snapshot({...data,purpose:'unknown'}),false);assert.equal(feedback({snapshot_id:'snapshot-1',useful:true,created_at:now}),true);assert.equal(feedback({snapshot_id:'snapshot-1',useful:'true',created_at:now}),false);
});
