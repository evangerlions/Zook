import {handleStudyNotesRequest} from '../../src/app/lighttick-study-routes.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
const url=process.env.LIGHTTICK_TEST_DATABASE_URL;
test('study notes persist, isolate owners, search and reject stale or concurrent revisions',{skip:!url},async()=>{
 const schema='core_notes_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:url});
 await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
 try{
 await pool.query(readFileSync(new URL('../../src/infrastructure/database/postgres/migrations/111_lighttick_study.sql',import.meta.url),'utf8'));
 await pool.query(`CREATE TABLE zook_lighttick_operations(app_id text,user_id text,operation_id text,device_id text,payload_hash text,entity_type text,entity_id text,action text,request_payload jsonb,result_payload jsonb,status text,created_at timestamptz,updated_at timestamptz,PRIMARY KEY(app_id,user_id,operation_id))`);
 for(const name of ["goals","plan_cycles","tasks"]) await pool.query(`CREATE TABLE zook_lighttick_${name}(app_id text,user_id text,id text)`);
 const r=new PostgresLightTickRepository(pool),o={appId:'lighttick',userId:'test-a'},other={...o,userId:'test-b'};
 const n={kind:'renzhi' as const,course_id:'note-1',notes:'保存后搜索',answers:{q:'答案'},revision:1,updated_at:new Date().toISOString()};
 await r.saveStudyNote(o,n);await r.saveStudyNote(o,{...n,course_id:'note-2'});
 assert.equal((await r.listStudyNotes(o,{q:'搜索'})).total,2);assert.equal(await r.getStudyNote(other,'renzhi','note-1'),undefined);
 const results=await Promise.allSettled([r.saveStudyNote(o,{...n,revision:2,notes:'winner-a'}),r.saveStudyNote(o,{...n,revision:2,notes:'winner-b'})]);
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await r.getStudyNote(o,'renzhi','note-1'))?.revision,2);
 await assert.rejects(()=>r.saveStudyNote(o,n),{statusCode:409});
 const request:any={path:'/api/v1/lighttick/study-notes/renzhi/note-receipt',method:'PUT',headers:{},body:{notes:'durable receipt',answers:{},base_revision:0,key:'core-receipt-1'}};
 const first=await handleStudyNotesRequest(r,o,request);const replay=await handleStudyNotesRequest(r,o,request);assert.deepEqual(replay,first);
 assert.equal((await r.getStudyNote(o,'renzhi','note-receipt'))?.revision,1);
 await assert.rejects(()=>handleStudyNotesRequest(r,o,{...request,body:{...request.body,notes:'different'}}),{statusCode:409});

 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();}
});
