import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {runPostgresMigrations} from "../../src/infrastructure/database/postgres/migrate.ts";
import {PostgresLightTickRepository} from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {NativeLearningService} from "../../src/modules/lighttick/learning/native-learning.service.ts";
import {LearningModuleService} from "../../src/modules/lighttick/learning/learning-module.service.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn||!["localhost","127.0.0.1"].includes(new URL(dsn).hostname)||!new URL(dsn).pathname.startsWith("/grow_web_u1_"))throw Error("Disposable localhost Grow database required");
test("PostgreSQL module CAS, immutable history, filtered pagination, receipts and private facts survive reconnect",async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});
 // DDL is replayed by API and worker startup; the second pass must preserve all data.
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});
 const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool),native=new NativeLearningService(repo,true),modules=new LearningModuleService(native);
 const owner={appId:"lighttick" as const,userId:"module-pg-"+process.pid},other={...owner,userId:owner.userId+"-other"};
 const body={base_revision:0,title:"Owner module",description:"Synthetic",template_id:null,archived:false};
 try{
  const original=await modules.save(owner,"module-pg",body,"pg-module-original");
  const attempts=await Promise.allSettled([modules.save(owner,"module-pg",{...body,base_revision:1,title:"One"},"pg-module-edit-one"),modules.save(owner,"module-pg",{...body,base_revision:1,title:"Two"},"pg-module-edit-two")]);
  assert.equal(attempts.filter(r=>r.status==="fulfilled").length,1);
  assert.equal((attempts.find(r=>r.status==="rejected") as PromiseRejectedResult).reason.statusCode,409);
  for(let i=0;i<4;i++)await native.saveCollection(owner,"collection-a-pg-"+i,{base_revision:0,title:"Unassigned",archived:false},"pg-unassigned-"+i);
  for(let i=0;i<3;i++)await native.saveCollection(owner,"collection-z-pg-"+i,{base_revision:0,title:"Assigned",archived:false,module_id:"module-pg",description:"Original context"},"pg-assigned-"+i);
  const first=await native.collections(owner,"",2,"module-pg");assert.equal(first.items.length,2);assert.equal((await native.collections(owner,first.next_cursor!,2,"module-pg")).items.length,1);
  await assert.rejects(native.saveCollection(other,"collection-foreign-pg",{base_revision:0,title:"Forbidden",archived:false,module_id:"module-pg"},"pg-module-foreign"),{statusCode:404});
  const pub=await native.publish(owner,"lesson-module-pg",{base_revision:0,collection_id:"collection-z-pg-0",number:1,title:"Personal lesson",content:"Immutable body",references:"",source_url:""},"pg-module-publish");
  await native.privateCommand(owner,pub.id,{action:"save",base_revision:0,content_version:pub.content_version,notes:"Private original",answers:[]},"pg-module-private");
  await native.saveCollection(owner,"collection-z-pg-0",{base_revision:1,title:"Assigned",archived:false,module_id:null},"pg-module-unassign");
  const fresh=new NativeLearningService(new PostgresLightTickRepository(pool),true),reconnected=new LearningModuleService(fresh);
  assert.deepEqual(await reconnected.save(owner,"module-pg",body,"pg-module-original"),original);
  assert.equal((await reconnected.history(owner,"module-pg")).items.length,2);
  assert.equal((await fresh.privateState(owner,pub.id,pub.content_version)).notes,"Private original");
  assert.equal((await fresh.lessons(owner,"",10,undefined,null)).items[0].id,pub.id);
  assert.equal((await fresh.collection(owner,"collection-z-pg-0")).description,"Original context");
  const save=repo.saveOperation.bind(repo);repo.saveOperation=async()=>{throw Error("injected receipt failure");};
  await assert.rejects(modules.save(owner,"module-pg",{...body,base_revision:2,title:"Must rollback"},"pg-module-rollback"),/receipt failure/);
  repo.saveOperation=save;assert.equal((await reconnected.history(owner,"module-pg")).items.length,2);
  await repo.deleteOwnerData(owner);assert.equal((await reconnected.list(owner)).items.length,0);
  for(const table of ["learning_module_versions","learning_modules","learning_collections"]){const r=await pool.query("SELECT COUNT(*)::int AS n FROM zook_lighttick_"+table+" WHERE app_id=$1 AND user_id=$2",[owner.appId,owner.userId]);assert.equal(r.rows[0].n,0);}
 }finally{await repo.deleteOwnerData(owner);await repo.deleteOwnerData(other);await pool.end();}
});
