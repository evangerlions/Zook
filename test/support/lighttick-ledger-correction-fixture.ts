import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { InvestmentLedgerService } from "../../src/modules/lighttick/investments/ledger.service.ts";
import { InvestmentLedgerRunner } from "../../src/modules/lighttick/investments/ledger.runner.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LedgerFact } from "../../src/modules/lighttick/investments/ledger.types.ts";
export async function ledgerCorrectionFixture(repo: LightTickRepository, userId="synthetic-correction") {
 const o={appId:"lighttick" as const,userId},id="inv-correction-account",q=new InMemoryJobQueue();let time=new Date("2026-11-08T08:00:00Z");
 const s=new InvestmentService(repo),l=new InvestmentLedgerService(repo,q,async()=>{},()=>time),runner=new InvestmentLedgerRunner(l);
 await s.createAccount(o,id,{base_revision:0,name:"Synthetic correction",currency:"CNY",baseline_date:"2026-01-01",opening_cash:"100",opening_positions:[]},"synthetic-correction-account");
 const cash=(amount:string):LedgerFact=>({kind:"cash",business_date:"2026-11-01",cash:{kind:"deposit",amount}});
 const append=async(input:LedgerFact,key="synthetic-original-cash")=>{const a=await repo.investments.account(o,id);const w=await l.append(o,id,{base_revision:a!.revision,...input},key);await runner.execute(o,w.id);return w;};
 const body=async(target:string,replacement:LedgerFact|null,reason="Correct original amount")=>{const page=await l.ledger(o,id,"",100,"2"),row=page.items.find(e=>e.id===target) as any;if(!row?.effective_fact)throw Error("Target is no longer current");return{base_revision:page.account_revision,business_date:"2026-11-08",kind:"correction",correction:{target_event_id:target,target_input_digest:row.effective_fact.input_digest,reason,replacement}};};
 return {o,id,s,l,runner,repo,q,cash,append,body,tick:()=>{time=new Date(time.getTime()+120001);}};
}
