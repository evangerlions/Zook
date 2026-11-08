import test from "node:test";
import assert from "node:assert/strict";
import { projectLedger, ledgerRows } from "../../src/modules/lighttick/investments/ledger.projection.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import type { LedgerEvent } from "../../src/modules/lighttick/investments/ledger.types.ts";
const cash = (amount: string, date = "2026-11-01") => ({kind: "cash" as const, business_date: date, cash: {kind: "deposit" as const, amount}});
const event = (id: string, sequence: number, input: LedgerEvent["input"]): LedgerEvent => ({id,sequence,input,account_id:"inv-account-fixture",created_at:"2026-11-08T00:00:00Z"});
const first=event("inv-original-event",2,cash("0.0000000001"));
const correction=(target: LedgerEvent, id="inv-correction-one", sequence=3, replacement: any=cash("9007199254740993.0000000001")) => event(id,sequence,{kind:"correction",business_date:"2026-11-08",correction:{target_event_id:target.id,target_input_digest:digest(target.input),reason:"Original amount was mistyped",replacement}});
test("correction and compensation project replacement chains without changing original facts or rounding decimals",()=>{
 const c=correction(first), input=structuredClone([first,c]);
 assert.deepEqual(projectLedger(input).active.map(e=>e.input),[cash("9007199254740993.0000000001")]);
 assert.deepEqual(input,[first,c]);
 const target=event(c.id,c.sequence,c.input.kind==="correction"?c.input.correction.replacement!:first.input);
 const next=correction(target,"inv-correction-two",4,cash("2.5","2026-10-30"));
 const rows=ledgerRows([next,first,c]);
 assert.equal(rows.find(e=>e.id===first.id)!.superseded_by,c.id);
 assert.equal(rows.find(e=>e.id===c.id)!.superseded_by,next.id);
 const effective=rows.find(e=>e.id===next.id)!.effective_fact!.input;assert.ok(effective&&effective.kind==="cash");assert.equal(effective.cash.amount,"2.5");
 assert.equal(projectLedger([next,first,c]).active[0].input.business_date,"2026-10-30");
});
test("void is an explicit new fact and cannot be applied twice or to a stale digest or foreign account",()=>{
 const c=correction(first,"inv-correction-void",3,null);assert.deepEqual(projectLedger([first,c]).active,[]);
 assert.throws(()=>projectLedger([first,c,correction(first,"inv-late-correction",4)]),/target/i);
 const stale=structuredClone(c);if(stale.input.kind==="correction")stale.input.correction.target_input_digest="0".repeat(64);
 assert.throws(()=>projectLedger([first,stale]),/digest/i);
 assert.throws(()=>projectLedger([first,{...c,account_id:"inv-other-account"}]),/account/i);
 assert.throws(()=>projectLedger([c]),/target/i);
});

import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ledgerCorrectionFixture } from "../support/lighttick-ledger-correction-fixture.ts";
import { InvestmentLedgerRunner } from "../../src/modules/lighttick/investments/ledger.runner.ts";
import { exportInvestments } from "../../src/modules/lighttick/investments/ledger.export.ts";
test("worker persists original, replacement and void compensation chain, original receipts and explicit old-schema boundary", async()=>{
 const f=await ledgerCorrectionFixture(new InMemoryLightTickRepository());const original=await f.append(f.cash("0.0000000001"));
 const raw=structuredClone(await f.repo.investments.ledger.events(f.o,f.id));
 const body=await f.body(original.id,f.cash("9007199254740993.0000000001"));const c=await f.l.append(f.o,f.id,body,"correction-original-identity");await f.runner.execute(f.o,c.id);
 assert.equal((await f.l.ledger(f.o,f.id,"",100,"2")).report!.result.cash,"9007199254741093.0000000001");
 assert.deepEqual((await f.repo.investments.ledger.events(f.o,f.id))[0],raw[0]);
 assert.equal((await f.l.append(f.o,f.id,body,"correction-original-identity")).status,"succeeded");
 await assert.rejects(()=>f.l.append(f.o,f.id,{...body,base_revision:3},"correction-original-identity"));
 await assert.rejects(()=>f.l.ledger(f.o,f.id),/SCHEMA_UPGRADE_REQUIRED/);
 const v=await f.l.append(f.o,f.id,await f.body(c.id,null),"explicit-void-command");await f.runner.execute(f.o,v.id);
 assert.equal((await f.l.ledger(f.o,f.id,"",100,"2")).report!.result.cash,"100");
 const restore=await f.l.append(f.o,f.id,await f.body(v.id,f.cash("2.5")),"compensate-void-original");await f.runner.execute(f.o,restore.id);
 const page=await f.l.ledger(f.o,f.id,"",100,"2");assert.equal(page.report!.result.cash,"102.5");assert.equal(page.report!.correction_count,3);assert.equal(page.report!.effective_event_count,1);
 const exported=await f.repo.transaction(f.o,()=>exportInvestments(f.repo,f.o));assert.equal(exported.ledgers[0].events.length,4);assert.equal(exported.ledgers[0].receipts.length,4);assert.deepEqual(exported.ledgers[0].receipts.find(x=>x.id===c.id)!.request_body,body);
});
test("correction validation refuses stale targets and cursor, nested input and foreign scope without creating work",async()=>{
 const f=await ledgerCorrectionFixture(new InMemoryLightTickRepository());const a=await f.append(f.cash("1"));await f.append(f.cash("2"),"second-pagination-fact");const before=await f.l.ledger(f.o,f.id,"",1,"2");const body=await f.body(a.id,f.cash("2"));
 for(const wrong of [{...body,correction:{...body.correction,target_input_digest:"0".repeat(64)}},{...body,correction:{...body.correction,replacement:body}},{...body,correction:{...body.correction,reason:" "}},{...body,correction:{...body.correction,replacement:f.cash("-1")}}])await assert.rejects(()=>f.l.append(f.o,f.id,wrong,"invalid-correction-"+JSON.stringify(wrong).length));
 await assert.rejects(()=>f.l.append({...f.o,userId:"other-owner"},f.id,body,"foreign-original-key"));
 const c=await f.l.append(f.o,f.id,body,"good-correction-command");await f.runner.execute(f.o,c.id);
 await assert.rejects(()=>f.l.append(f.o,f.id,{...body,base_revision:4},"late-old-target"),/target/i);
 assert.equal((await f.repo.investments.ledger.events(f.o,f.id)).length,3);assert.equal(before.account_revision,3);assert.ok(before.next_cursor);await assert.rejects(()=>f.l.ledger(f.o,f.id,before.next_cursor!,1,"2"),/snapshot changed/);
});
test("correction cancellation fences late calculation and crash rollback leaves no replaced original",async()=>{
 const f=await ledgerCorrectionFixture(new InMemoryLightTickRepository());const a=await f.append(f.cash("1"));const b=await f.body(a.id,null);const w=await f.l.append(f.o,f.id,b,"cancel-correction-work");
 let release!:()=>void,started!:()=>void;const blocked=new Promise<void>(r=>{started=r;});const runner=new InvestmentLedgerRunner(f.l,async()=>{},async(account,events)=>{started();await new Promise<void>(r=>{release=r;});return f.runner.calculate(account,events);});
 const executing=runner.execute(f.o,w.id);await blocked;const live=await f.l.work(f.o,w.id);await f.l.cancel(f.o,w.id,{base_revision:live.revision},"cancel-original-correction");release();await executing;
 assert.equal((await f.l.work(f.o,w.id)).status,"cancelled");assert.equal((await f.repo.investments.ledger.events(f.o,f.id)).length,1);
 const next=await f.l.append(f.o,f.id,b,"rollback-correction-work");const original=f.repo.investments.ledger.append.bind(f.repo.investments.ledger);f.repo.investments.ledger.append=async(o,e)=>{await original(o,e);throw Error("Synthetic persistence crash");};
 await assert.rejects(()=>f.runner.execute(f.o,next.id),/persistence crash/);assert.equal((await f.repo.investments.ledger.events(f.o,f.id)).length,1);assert.equal((await f.repo.investments.account(f.o,f.id))!.revision,2);f.repo.investments.ledger.append=original;f.tick();await f.runner.execute(f.o,next.id);assert.equal((await f.l.work(f.o,next.id)).status,"succeeded");
});

test("same-day replacement retains the original accounting position before dependent sales",()=>{
 const buy=event("inv-original-buy",2,{kind:"fill",business_date:"2026-11-01",fill:{instrument_id:"inv-synthetic-symbol",side:"buy",price:"1",quantity:"2",fee:"0",tax:"0",source:"manual",settlement_amount:null}});
 const sell=event("inv-dependent-sale",3,{kind:"fill",business_date:"2026-11-01",fill:{instrument_id:"inv-synthetic-symbol",side:"sell",price:"2",quantity:"1",fee:"0",tax:"0",source:"manual",settlement_amount:null}});
 const c=correction(buy,"inv-buy-correction",4,{...buy.input,fill:{...(buy.input as any).fill,price:"1.1"}});
 const projected=projectLedger([buy,sell,c]);assert.deepEqual(projected.active.map(e=>e.id),[c.id,sell.id]);assert.equal(projected.active[0].sequence,2);
});
