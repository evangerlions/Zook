import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningNotebookService } from "../../src/modules/lighttick/learning/learning-notebook.service.ts";
const owner = {appId:"lighttick" as const,userId:"notebook-alice"};
async function setup() {
 const repo=new InMemoryLightTickRepository(); let now=new Date("2026-11-14T08:00:00Z");
 const native=new NativeLearningService(repo,true,()=>now),notebook=new LearningNotebookService(native);
 await native.saveCollection(owner,"collection-notes",{base_revision:0,title:"Course",module_id:"english-reading",archived:false},"notes-collection");
 const create=async(id:string,notes:string,answer="")=>{
  const lesson=await native.publish(owner,id,{base_revision:0,collection_id:"collection-notes",number:Number(id.split("-").at(-1)),title:"Lesson "+id,content:"# Original",references:""},"publish-"+id);
  if(notes || answer) await native.privateCommand(owner,id,{action:"save",content_version:lesson.content_version,base_revision:0,notes,answers:[{id:"answer",prompt:"Question",answer}]},"save-"+id);
  return lesson;
 };
 return {repo,native,notebook,create,setDate:(date:string)=>{now=new Date(date);}};
}
test("notebook lists saved notes and answers before completion, omits whitespace and isolates owners",async()=>{
 const {notebook,create,native}=await setup();
 await create("lesson-notes-1","First private note");await create("lesson-notes-2","","Answer only");await create("lesson-notes-3"," \n\t "," \t ");
 const page=await notebook.list(owner,{});
 assert.equal(page.total,2);assert.equal(page.page_size,20);assert.equal(page.items[0].answer_count,0);
 assert.equal(page.items[1].answer_count,1);assert.equal(page.items[1].preview,"Answer only");
 assert.equal(page.items[0].module,"module/english-reading");
 await native.authority({...owner,userId:"bob"});
 assert.equal((await notebook.list({...owner,userId:"bob"},{})).total,0);
});
test("search is literal, covers note, answer and course ID; filters and pagination compose",async()=>{
 const {notebook,create}=await setup();
 await create("lesson-notes-1","literal %_\\ marker");await create("lesson-notes-2","second","Searchable answer");
 assert.equal((await notebook.list(owner,{q:"%_\\"})).total,1);
 assert.equal((await notebook.list(owner,{q:"Searchable"})).items[0].lesson_id,"lesson-notes-2");
 assert.equal((await notebook.list(owner,{q:"lesson-notes-1"})).total,1);
 assert.equal((await notebook.list(owner,{module:"unassigned"})).total,0);
 const last=await notebook.list(owner,{page:"99",page_size:"1",module:"module/english-reading"});
 assert.equal(last.page,2);assert.equal(last.total,2);assert.equal(last.items.length,1);
 for(const query of [{page:"0"},{page_size:"101"},{page:"1e2"},{q:"x".repeat(501)}])await assert.rejects(notebook.list(owner,query));
});
test("position updates do not reorder notes; old versions and archived sources remain discoverable",async()=>{
 const {repo,native,notebook,create,setDate}=await setup();
 const first=await create("lesson-notes-1","Old version note");setDate("2026-11-14T09:00:00Z");await create("lesson-notes-2","Newer note");
 setDate("2026-11-14T10:00:00Z");await native.privateCommand(owner,first.id,{action:"position",content_version:first.content_version,base_revision:0,position:50},"notebook-position");
 assert.equal((await notebook.list(owner,{})).items[0].lesson_id,"lesson-notes-2");
 await native.publish(owner,first.id,{base_revision:1,collection_id:"collection-notes",number:1,title:"Revised",content:"# Revised",references:""},"notebook-revised");
 const old=(await notebook.list(owner,{q:"Old version"})).items[0];assert.equal(old.content_version,first.content_version);assert.equal(old.is_current,false);assert.equal(old.available,true);
 const lesson=(await repo.getNativeLesson(owner,first.id))!;await repo.saveNativeLesson({...lesson,archived:true,revision:lesson.revision+1},lesson.revision);
 assert.equal((await notebook.list(owner,{q:"Old version"})).items[0].available,false);
 const authority=(await repo.getLearningAuthority(owner))!;await repo.saveLearningAuthority({...authority,revision:authority.revision+1,privateEnabled:false},authority.revision);
 await assert.rejects(notebook.list(owner,{}),/consent/i);
});
