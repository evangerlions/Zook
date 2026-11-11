import assert from "node:assert/strict";
import test from "node:test";
import {InMemoryLightTickRepository} from "../../src/testing/in-memory-lighttick-repository.ts";
import {NativeLearningService} from "../../src/modules/lighttick/learning/native-learning.service.ts";
import {LearningModuleService} from "../../src/modules/lighttick/learning/learning-module.service.ts";
const owner={appId:"lighttick",userId:"module-owner"} as const,other={...owner,userId:"module-other"};
const input={base_revision:0,title:"My reading",description:"Created by the owner",template_id:"english-reading",archived:false};
const setup=()=>{const repo=new InMemoryLightTickRepository(),native=new NativeLearningService(repo,true);return {repo,native,modules:new LearningModuleService(native)};};
test("suggestions never preload individual projects; modules retain owner, CAS and exact original receipts",async()=>{
 const {modules}=setup();assert.equal((await modules.list(owner)).items.length,0);assert.equal((await modules.templates(owner)).items.length,6);
 const row=await modules.save(owner,"module-reading",input,"module-create-original");
 assert.equal(row.template_id,"english-reading");
 await modules.save(owner,row.id,{...input,title:"Renamed",base_revision:1},"module-update-original");
 assert.deepEqual(await modules.save(owner,row.id,input,"module-create-original"),row);
 await assert.rejects(modules.save(owner,row.id,{...input,title:"changed"},"module-create-original"),{statusCode:409});
 await assert.rejects(modules.read(other,row.id),{statusCode:404});assert.equal((await modules.list(other)).items.length,0);
 await assert.rejects(modules.save(owner,row.id,{...input,base_revision:1},"module-stale-revision"),{statusCode:409});
});
test("collection filtering happens before keyset pagination and cursors bind query, owner and catalog revision",async()=>{
 const {modules,native}=setup();await modules.save(owner,"module-reading",input,"module-create-original");
 for(let i=0;i<7;i++)await native.saveCollection(owner,"collection-a-"+i,{base_revision:0,title:"Old",archived:false},"old-collection-"+i);
 for(let i=0;i<3;i++)await native.saveCollection(owner,"collection-z-"+i,{base_revision:0,title:"Mine",archived:false,module_id:"module-reading",description:"Context"},"new-collection-"+i);
 const first=await native.collections(owner,"",2,"module-reading");assert.equal(first.items.length,2);assert.ok(first.next_cursor);
 const last=await native.collections(owner,first.next_cursor!,2,"module-reading");assert.equal(last.items.length,1);assert.equal(last.next_cursor,null);
 assert.equal((await native.collections(owner,"",2,null)).items.length,2);
 await assert.rejects(native.collections(other,first.next_cursor!,2,"module-reading"),{statusCode:400});
 await assert.rejects(native.collections(owner,first.next_cursor!,2,null),{statusCode:400});
 await modules.save(owner,"module-reading",{...input,base_revision:1,archived:true},"module-archive-original");
 await assert.rejects(native.collections(owner,first.next_cursor!,2,"module-reading"),{statusCode:409});
 assert.equal((await modules.list(owner)).items.length,0);assert.equal((await modules.list(owner,{filter:"archived"})).items.length,1);
});
test("module moves preserve lesson identity, immutable publication and private notes; existing publication protocol is reused",async()=>{
 const {modules,native,repo}=setup();await modules.save(owner,"module-reading",input,"module-create-original");
 await native.saveCollection(owner,"collection-manual",{base_revision:0,title:"Collection",archived:false,module_id:"module-reading",description:"My context"},"collection-create-original");
 const lesson=await native.publish(owner,"lesson-module-one",{base_revision:0,collection_id:"collection-manual",number:1,title:"My generated content",content:"Original",references:"",source_url:""},"lesson-publish-original");
 const state=await native.privateState(owner,lesson.id,lesson.content_version);
 await native.privateCommand(owner,lesson.id,{action:"save",base_revision:state.notesRevision,content_version:lesson.content_version,notes:"Personal notes",answers:[]},"module-private-original");
 await native.saveCollection(owner,"collection-manual",{base_revision:1,title:"Collection",archived:false,module_id:null},"collection-unassign-original");
 assert.equal((await repo.getLearningCollection(owner,"collection-manual"))!.description,"My context");
 assert.equal((await native.publication(owner,lesson.id)).lesson.publishedVersion,lesson.content_version);
 assert.equal((await native.privateState(owner,lesson.id,lesson.content_version)).notes,"Personal notes");
 assert.equal((await native.lessons(owner,"",10,undefined,"module-reading")).items.length,0);
 assert.equal((await native.lessons(owner,"",10,undefined,null)).items.length,1);
 await assert.rejects(native.saveCollection(other,"collection-other",{base_revision:0,title:"Forbidden",archived:false,module_id:"module-reading"},"foreign-module-collection"),{statusCode:404});
});
test("module and category metadata roll back with failed receipt and account deletion removes the new store",async()=>{
 const {modules,repo}=setup();await modules.save(owner,"module-reading",input,"module-create-original");
 const save=repo.saveOperation;repo.saveOperation=async()=>{throw Error("receipt failure");};
 await assert.rejects(modules.save(owner,"module-reading",{...input,base_revision:1,title:"Must rollback"},"module-rollback-original"),/receipt failure/);
 repo.saveOperation=save;assert.equal((await modules.read(owner,"module-reading")).revision,1);assert.equal((await modules.history(owner,"module-reading")).items.length,1);
 await repo.deleteOwnerData(owner);assert.equal((await modules.list(owner)).items.length,0);
});

test("formal generated routes can be classified without changing their title, state or route revision",async()=>{
 const {modules,native,repo}=setup();await modules.save(owner,"module-reading",input,"formal-module-create");
 await repo.saveLearningCollection({...owner,id:"plan-personal",title:"Formal title",revision:1,archived:false,updatedAt:new Date().toISOString()},0);
 const now=new Date().toISOString();await repo.learningRoutes.saveLearningRoute({...owner,id:"plan-personal",revision:1,publishedVersion:1,status:"active",brief:{title:"Formal title",goal:"Personal",level:"Beginner",minutes:20,pacing:"self_paced",sessions:1},document:{prerequisites:"",stages:[],lessons:[]},updatedAt:now},0);
 await native.saveCollection(owner,"plan-personal",{base_revision:1,title:"Formal title",archived:false,module_id:"module-reading",description:"Owner grouping"},"formal-classification");
 assert.equal((await repo.learningRoutes.getLearningRoute(owner,"plan-personal"))!.revision,1);
 assert.equal((await native.collection(owner,"plan-personal")).module_id,"module-reading");
 await assert.rejects(native.saveCollection(owner,"plan-personal",{base_revision:2,title:"Changed",archived:false,module_id:null},"formal-reject-title"),{statusCode:409});
});
