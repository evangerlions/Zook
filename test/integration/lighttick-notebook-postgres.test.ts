import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningNotebookService } from "../../src/modules/lighttick/learning/learning-notebook.service.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn || new URL(dsn).hostname!=="127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_"))throw Error("Disposable notebook PostgreSQL database required");
test("PostgreSQL notebook: Unicode, literal search, module paging, saved-time order, old versions, rollback and reconnect",async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});
 const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool),owner={appId:"lighttick" as const,userId:"notebook-pg-"+randomUUID()};
 let clock=new Date("2026-11-14T08:00:00Z");const native=new NativeLearningService(repo,true,()=>clock),notebook=new LearningNotebookService(native);
 try{
  await native.saveCollection(owner,"notebook-pg",{base_revision:0,title:"Notebook",module_id:"english-reading",archived:false},"notebook-collection");
  const lessons=[];
  for(let i=1;i<=23;i++){
   clock=new Date(Date.UTC(2026,10,14,8,i));
   const lesson=await native.publish(owner,"lesson-notebook-"+String(i).padStart(2,"0"),{base_revision:0,collection_id:"notebook-pg",number:i,title:"课程 "+i,content:"# 正文 "+i,references:""},"publish-notebook-"+i);lessons.push(lesson);
   await native.privateCommand(owner,lesson.id,{action:"save",content_version:lesson.content_version,base_revision:0,notes:i===23?"":i===1?"literal %_\\ 中文笔记":"练习笔记 "+i,answers:[{id:"a",prompt:"Question",answer:i===23?"只有答案也能找回":""}]},"save-notebook-"+i);
  }
  assert.equal((await notebook.list(owner,{})).total,23);
  const second=await notebook.list(owner,{page:"2"});assert.equal(second.items.length,3);assert.equal(second.modules[0].title,"英文阅读");
  assert.equal((await notebook.list(owner,{q:"%_\\"})).items[0].lesson_id,lessons[0].id);
  assert.equal((await notebook.list(owner,{q:"只有答案"})).items[0].answer_count,1);
  const before=(await notebook.list(owner,{})).items.map(r=>r.lesson_id);
  clock=new Date("2026-11-14T12:00:00Z");await native.privateCommand(owner,lessons[0].id,{action:"position",content_version:lessons[0].content_version,base_revision:0,position:100},"notebook-position");
  assert.deepEqual((await notebook.list(owner,{})).items.map(r=>r.lesson_id),before);
  await native.publish(owner,lessons[0].id,{base_revision:1,collection_id:"notebook-pg",number:1,title:"更新的课程",content:"# 改版正文",references:""},"notebook-version-two");
  const old=(await notebook.list(owner,{q:"%_\\"})).items[0];assert.equal(old.is_current,false);assert.equal(old.content_version,lessons[0].content_version);
  await assert.rejects(repo.transaction(owner,async()=>{await native.privateCommand(owner,lessons[0].id,{action:"save",content_version:old.content_version,base_revision:1,notes:"rolled back",answers:[]},"notebook-rollback");throw Error("synthetic rollback");}));
  const reopened=new LearningNotebookService(new NativeLearningService(new PostgresLightTickRepository(pool),true));
  assert.equal((await reopened.list(owner,{q:"%_\\"})).total,1);assert.equal((await reopened.list(owner,{q:"rolled back"})).total,0);
  const row=(await repo.getNativeLesson(owner,lessons[0].id))!;await repo.saveNativeLesson({...row,revision:row.revision+1,archived:true},row.revision);
  assert.equal((await reopened.list(owner,{q:"%_\\"})).items[0].available,false);
  await native.authority({...owner,userId:"notebook-bob"});assert.equal((await reopened.list({...owner,userId:"notebook-bob"},{})).total,0);
 }finally{await repo.deleteOwnerData(owner);await repo.deleteOwnerData({...owner,userId:"notebook-bob"});await pool.end();}
});
