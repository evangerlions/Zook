import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresLightTickRepository } from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import { runPostgresMigrations } from '../../src/infrastructure/database/postgres/migrate.ts';
import { LightTickReflectionService } from '../../src/modules/lighttick/lighttick-reflection.service.ts';
import { LightTickGoalService } from '../../src/modules/lighttick/lighttick-goal.service.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Disposable LIGHTTICK_TEST_DATABASE_URL required');
test('journal survives reconnect, concurrent CAS, migration replay and account deletion',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});const pool=new Pool({connectionString});
 const owner={appId:'lighttick' as const,userId:'reflection-pg'};const repo=new PostgresLightTickRepository(pool);await repo.deleteOwnerData(owner);
 try{
 const goal=await new LightTickGoalService(repo).create(owner,{title:'通用学习规划',constraints:{}});
 const input={goal_id:goal.id,period_start:'2026-09-19',period_end:'2026-09-19',content:'完成阅读',next_action:'整理笔记',base_version:0};
 const service=new LightTickReflectionService(repo);const first=await service.save(owner,'reflection-pg-001',input);
 const reconnect=new LightTickReflectionService(new PostgresLightTickRepository(pool));assert.equal((await reconnect.list(owner,goal.id))[0].periodStart,'2026-09-19');
 assert.equal((await reconnect.save(owner,first.id,input)).version,1);
 const attempts=await Promise.allSettled(['修改A','修改B'].map(content=>reconnect.save(owner,first.id,{...input,content,base_version:1})));
 assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);
 await runPostgresMigrations({connectionString,log:()=>{}});assert.equal((await reconnect.list(owner,goal.id))[0].version,2);
 await repo.deleteOwnerData(owner);assert.equal((await repo.listReflections(owner)).length,0);
 }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
