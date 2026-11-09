import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ledgerCorrectionFixture } from "../support/lighttick-ledger-correction-fixture.ts";
import { InvestmentLedgerRunner } from "../../src/modules/lighttick/investments/ledger.runner.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn||new URL(dsn).hostname!=="127.0.0.1"||!new URL(dsn).pathname.startsWith("/grow_web_u1_"))throw Error("Dedicated synthetic localhost database required");
test("PG immutable corrections retain NUMERIC precision, FK scope, original requests, compensation and crash recovery",async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});await runPostgresMigrations({connectionString:dsn,log:()=>{}});
 const pool=new Pool({connectionString:dsn});const repo=new PostgresLightTickRepository(pool);
 try {
  const f=await ledgerCorrectionFixture(repo,"pg-correction-"+process.pid);const first=await f.append(f.cash("0.0000000001"));const raw=await repo.investments.ledger.events(f.o,f.id);
  const body=await f.body(first.id,f.cash("9007199254740993.0000000001"));const c=await f.l.append(f.o,f.id,body,"pg-correction-original");
  const original=repo.investments.ledger.append.bind(repo.investments.ledger);repo.investments.ledger.append=async(o,e)=>{await original(o,e);throw Error("Synthetic PG crash after correction insert");};
  await assert.rejects(()=>f.runner.execute(f.o,c.id),/Synthetic PG crash/);assert.deepEqual(await repo.investments.ledger.events(f.o,f.id),raw);assert.equal((await repo.investments.account(f.o,f.id))!.revision,2);
  repo.investments.ledger.append=original;f.tick();const recovered=new InvestmentLedgerRunner(f.l);await recovered.execute(f.o,c.id);
  const p=await f.l.ledger(f.o,f.id,"",100,"2");assert.equal(p.report!.result.cash,"9007199254741093.0000000001");assert.deepEqual((await repo.investments.ledger.events(f.o,f.id))[0],raw[0]);
  const stored=await pool.query("SELECT amount::text,corrects_id,correction FROM zook_lighttick_investment_events WHERE app_id=$1 AND user_id=$2 AND id=$3",[f.o.appId,f.o.userId,c.id]);assert.equal(stored.rows[0].amount,"9007199254740993.0000000001");assert.equal(stored.rows[0].corrects_id,first.id);assert.deepEqual(stored.rows[0].correction.replacement,{kind:"cash",business_date:"2026-11-01"});
  assert.equal((await f.l.append(f.o,f.id,body,"pg-correction-original")).id,c.id);await assert.rejects(()=>f.l.ledger(f.o,f.id),/UPGRADE_REQUIRED/);
  const v=await f.l.append(f.o,f.id,await f.body(c.id,null),"pg-void-correction");await f.runner.execute(f.o,v.id);const r=await f.l.append(f.o,f.id,await f.body(v.id,f.cash("2.5")),"pg-compensate-void");await f.runner.execute(f.o,r.id);assert.equal((await f.l.ledger(f.o,f.id,"",100,"2")).report!.result.cash,"102.5");
  const next=await f.l.append(f.o,f.id,await f.body(r.id,null),"pg-target-account-fk");
  await assert.rejects(()=>repo.transaction(f.o,()=>original(f.o,{id:next.id,account_id:f.id,sequence:99,created_at:new Date().toISOString(),input:{business_date:"2026-11-08",kind:"correction",correction:{target_event_id:"inv-missing-original",target_input_digest:"0".repeat(64),reason:"Invalid foreign target",replacement:null}}})),/foreign key/i);
  assert.equal((await repo.investments.ledger.events(f.o,f.id)).length,4);
  await repo.deleteOwnerData(f.o);assert.equal((await pool.query("SELECT count(*)::int AS n FROM zook_lighttick_investment_events WHERE user_id=$1",[f.o.userId])).rows[0].n,0);
 } finally {await pool.end();}
});

test("PG competing corrections serialize at owner commit and confirm at most one immutable replacement",async()=>{
 const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool);
 try{const f=await ledgerCorrectionFixture(repo,"pg-correction-race-"+process.pid);const a=await f.append(f.cash("1")),b=await f.body(a.id,f.cash("2"));
 const works=await Promise.all([f.l.append(f.o,f.id,b,"correction-race-first"),f.l.append(f.o,f.id,b,"correction-race-second")]);await Promise.all(works.map(w=>f.runner.execute(f.o,w.id)));
 const statuses=await Promise.all(works.map(w=>f.l.work(f.o,w.id)));assert.equal(statuses.filter(w=>w.status==="succeeded").length,1);assert.equal(statuses.filter(w=>w.status==="failed").length,1);
 assert.equal((await repo.investments.ledger.events(f.o,f.id)).length,2);assert.equal((await f.l.ledger(f.o,f.id,"",100,"2")).report!.result.cash,"102");await repo.deleteOwnerData(f.o);
 }finally{await pool.end();}
});
