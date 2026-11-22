import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningContentSyncService } from "../../src/modules/lighttick/learning/content-sync.service.ts";
const owner={appId:"lighttick" as const,userId:"sync-fixture"};
const credentials={repository:"test/content",branch:"main",token:"synthetic-only"};
async function fixture() {
 const repo=new InMemoryLightTickRepository(),native=new NativeLearningService(repo,true);
 await native.authority(owner);
 const module={...owner,id:"english-reading",title:"English",description:"",enabled:true,sourceType:"github" as const,sourceUrl:null,sourcePath:"courses",revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),sourceConfig:{github:{repository:credentials.repository,branch:credentials.branch,prefix:"courses",syncInterval:"manual" as const}}};
 await repo.saveLearningModule(module,0);
 return {repo,native,module};
}
test("sync refuses truncated trees, oversized files and upstream failure before writing",async()=>{
 for(const failure of ["truncated","oversized","unavailable"]) {
  const {repo,native}=await fixture();
  const transport:typeof fetch=async url=>{
   if(String(url).includes("git/ref"))return Response.json({object:{sha:"a".repeat(40)}});
   if(failure==="unavailable")return new Response("secret upstream diagnostic",{status:403});
   return Response.json({truncated:failure==="truncated",tree:[{type:"blob",path:"courses/one.md",sha:"blob",size:2*1024*1024}]});
  };
  await assert.rejects(new LearningContentSyncService(repo,transport).sync(owner,"english-reading",false,credentials,fn=>native.command(owner,"sync-failure-key","module:sync","english-reading",{},fn),async()=>{}),error=>{
   assert.equal(String(error).includes("secret upstream diagnostic"),false);return true;
  });
  assert.equal((await repo.listNativeLessons(owner,"",100)).length,0);
  assert.equal((await repo.getLearningModule(owner,"english-reading"))?.revision,1);
  assert.equal(await repo.getOperation(owner,"learning:sync-failure-key"),undefined);
 }
});
test("a module changed during remote reads cannot publish stale content",async()=>{
 const {repo,native,module}=await fixture();
 const transport:typeof fetch=async url=>{
  if(String(url).includes("git/ref"))return Response.json({object:{sha:"a".repeat(40)}});
  if(String(url).includes("git/trees"))return Response.json({truncated:false,tree:[{type:"blob",path:"courses/one.md",sha:"blob",size:20}]});
  await repo.saveLearningModule({...module,revision:2},1);
  return Response.json({content:Buffer.from("# 新课程").toString("base64"),encoding:"base64"});
 };
 await assert.rejects(new LearningContentSyncService(repo,transport).sync(owner,module.id,false,credentials,fn=>native.command(owner,"sync-stale-key","module:sync",module.id,{},fn),async()=>{}),/Module changed during sync/);
 assert.equal((await repo.listNativeLessons(owner,"",100)).length,0);
});
test("module filters apply before pagination, preserving other modules",async()=>{
 const {repo,native}=await fixture();
 for(const [id,moduleId] of [["collection-a","other"],["collection-b","english-reading"],["collection-c","english-reading"]]) await repo.saveLearningCollection({...owner,id,moduleId,title:id,description:"",revision:1,archived:false,updatedAt:new Date().toISOString()},0);
 const first=await native.collections(owner,"",1,"english-reading");
 assert.deepEqual(first.items.map(i=>i.id),["collection-b"]);assert.ok(first.next_cursor);
 const next=await native.collections(owner,first.next_cursor!,1,"english-reading");
 assert.deepEqual(next.items.map(i=>i.id),["collection-c"]);
 await assert.rejects(native.collections(owner,first.next_cursor!,1,"other"));
});
