import test from "node:test";
import assert from "node:assert/strict";
import {Pool} from "pg";
import {PostgresLightTickRepository} from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {runPostgresMigrations} from "../../src/infrastructure/database/postgres/migrate.ts";
import {NativeLearningService} from "../../src/modules/lighttick/learning/native-learning.service.ts";
import {LearningRouteService} from "../../src/modules/lighttick/learning/learning-route.service.ts";
import {routeProgress} from "../../src/modules/lighttick/learning/learning-route.progress.ts";
import {routeFixture} from "../support/learning-route-fixture.ts";
import {courseMigrationFixture} from "../support/learning-route-migration-fixture.ts";
import {LearningMigrationService} from "../../src/modules/lighttick/learning/learning-migration.service.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn||!['localhost','127.0.0.1'].includes(new URL(dsn).hostname)||!new URL(dsn).pathname.startsWith('/grow_web_u1_'))throw Error("Disposable synthetic Grow database required");
test("PostgreSQL route CAS, atomic lesson publication, reconnect and deletion preserve versioned course facts",async()=>{
  await runPostgresMigrations({connectionString:dsn,log:()=>{}});
  const pool=new Pool({connectionString:dsn,max:6}),repo=new PostgresLightTickRepository(pool),owner={appId:"lighttick" as const,userId:"course-route-pg-"+process.pid},id="plan-course-pg";
  const native=new NativeLearningService(repo,true),routes=new LearningRouteService(native);
  try{
    await routes.save(owner,id,{base_revision:0,...routeFixture()},"route-pg-create");
    const outcomes=await Promise.allSettled([routes.publish(owner,id,{base_revision:1},"route-pg-publish-one"),routes.publish(owner,id,{base_revision:1},"route-pg-publish-two")]);
    assert.equal(outcomes.filter(r=>r.status==='fulfilled').length,1);
    const body={base_revision:2,base_lesson_revision:0,lesson_id:"lesson-course-pg-first",content:"Synthetic PG teaching"};
    const insert=repo.learningRoutes.insertRouteLessonLink.bind(repo.learningRoutes);
    repo.learningRoutes.insertRouteLessonLink=async()=>{throw Error("Synthetic crash before linking");};
    await assert.rejects(routes.publishLesson(owner,id,1,body,"route-pg-lesson-original"));
    assert.equal(await repo.getNativeLesson(owner,body.lesson_id),undefined);
    assert.equal(await repo.getOperation(owner,"learning:route-pg-lesson-original"),undefined);
    repo.learningRoutes.insertRouteLessonLink=insert;
    const result=await routes.publishLesson(owner,id,1,body,"route-pg-lesson-original");
    await native.privateCommand(owner,result.id,{action:"complete",content_version:result.content_version,base_revision:0},"route-pg-complete");
    const reconnect=new NativeLearningService(new PostgresLightTickRepository(pool),true);
    assert.equal((await routeProgress(reconnect,owner,id)).stages[0].percent,100);
    assert.deepEqual(await new LearningRouteService(reconnect).publishLesson(owner,id,1,body,"route-pg-lesson-original"),result);
    assert.equal((await new LearningRouteService(reconnect).read(owner,id,1)).document.lessons.length,2);
    await repo.deleteOwnerData(owner);assert.equal(await repo.learningRoutes.getLearningRoute(owner,id),undefined);
  }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
test("PostgreSQL formal route migration verifies counts, history digests and relationships with unknown publication time retained",async()=>{
  await runPostgresMigrations({connectionString:dsn,log:()=>{}});
  const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool),f=courseMigrationFixture('route-import-pg-'+process.pid),owner={appId:'lighttick' as const,userId:f.bundle.mapping.target_user_id};
  const native=new NativeLearningService(repo,true),migration=new LearningMigrationService(native);
  try{
    for(const action of ['freeze','import','verify','activate'] as const){const a=await repo.getLearningAuthority(owner);await migration.command(owner,action,f.bundle,f.digest,a?.revision??0,'pg-course-import-'+action);}
    const restarted=new PostgresLightTickRepository(pool),current=new NativeLearningService(restarted,true);
    assert.equal((await new LearningRouteService(current).read(owner,f.id,1)).created_at,null);
    assert.equal((await routeProgress(current,owner,f.id)).lessons[0].lesson_id,f.lesson);
    assert.deepEqual(await restarted.learningRoutes.counts(owner),{routes:1,route_versions:2,route_links:1,work:0});
  }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
