import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
const owner={appId:'lighttick' as const,userId:'learning-work-synthetic'},routeId='plan-learning-worker';
function setup(complete?: (input:any)=>Promise<any>){
  let now=new Date('2026-11-04T08:00:00Z');const repo=new InMemoryLightTickRepository(),queue=new InMemoryJobQueue();
  const native=new NativeLearningService(repo,true,()=>now),routes=new LearningRouteService(native),work=new LearningWorkService(routes,queue);
  const llm={complete:complete??(async()=>({text:JSON.stringify(routeFixture().document),provider:'synthetic',providerModel:'fixture'}))} as any;
  const runner=new LearningWorkRunner(work,llm,{readFile:async()=>{throw Error('Unavailable owner file');},fetchUrl:async()=>{throw Error('Unexpected external fetch');}});
  return {repo,queue,native,routes,work,runner,llm,advance:(ms:number)=>{now=new Date(now.getTime()+ms);}};
}
const request=()=>({kind:'route_draft',route_id:routeId,base_revision:0,brief:routeFixture().brief});
function signal(){let resolve!:(value?:any)=>void;const promise=new Promise<any>(r=>{resolve=r;});return {resolve,promise};}
test('existing worker dispatches durable work, restores missing queue delivery, and adopts only an explicitly reviewed draft once',async()=>{
  let calls=0;const f=setup(async input=>{calls++;assert.deepEqual(input.usageOwner,owner);assert.ok(input.signal instanceof AbortSignal);return {text:JSON.stringify(routeFixture().document),provider:'synthetic',providerModel:'fixture'};});
  f.queue.markNextAddAsFailure();const created=await f.work.create(owner,request(),'work-original-create');
  assert.equal((await f.work.read(owner,created.id)).error_code,'QUEUE_UNAVAILABLE');
  const worker=new LightTickWorker(new LightTickAiRunner(f.repo,f.llm),undefined,f.runner);
  assert.equal(await worker.recover(),1);
  assert.equal(JSON.stringify(f.queue.jobs).includes('Synthetic course'),false,'shared queue carries IDs, not source body');
  await f.queue.processDueJobs(job=>worker.process(job));
  const done=await f.work.read(owner,created.id);assert.equal(done.status,'succeeded');
  await f.runner.execute(owner,created.id);assert.equal(calls,1);
  assert.equal(await f.repo.learningRoutes.getLearningRoute(owner,routeId),undefined,'generation never publishes or creates a course');
  const b={base_revision:done.revision,base_route_revision:0,expected_digest:done.output_digest};
  const adopted=await f.work.adopt(owner,created.id,b,'work-adopt-original');
  assert.equal(adopted.result.published_version,0);assert.equal(adopted.result.status,'draft');
  assert.deepEqual(await f.work.adopt(owner,created.id,b,'work-adopt-original'),adopted);
  await assert.rejects(f.work.adopt(owner,created.id,{...b,base_revision:done.revision+1},'work-adopt-again'),{statusCode:409});
  await assert.rejects(f.work.read({...owner,userId:'other-owner'},created.id),{statusCode:404});
});
test('cancelled or superseded lease cannot persist a late model result after restart',async()=>{
  for(const cancel of [true,false]){
    const started=signal(),release=signal();let calls=0;
    const f=setup(async()=>{const attempt=++calls;if(attempt===1){started.resolve();await release.promise;}
      const document=routeFixture().document;document.stages[0].title=attempt===1?'Old attempt':'Winning attempt';
      return {text:JSON.stringify(document),provider:'synthetic',providerModel:'fixture'};
    });
    const created=await f.work.create(owner,request(),'work-lease-original'),first=f.runner.execute(owner,created.id);await started.promise;
    if(cancel){const current=await f.work.read(owner,created.id);await f.work.cancel(owner,created.id,{base_revision:current.revision},'work-cancel-original');}
    else{f.advance(60000);const restarted=new LearningWorkRunner(f.work,f.llm,f.runner.sources);await restarted.execute(owner,created.id);}
    release.resolve();await first;const result=await f.work.read(owner,created.id);
    assert.equal(result.status,cancel?'cancelled':'succeeded');
    if(cancel)assert.equal(result.output,null);else{assert.equal(result.attempt,2);assert.equal(result.output!.document.stages[0].title,'Winning attempt');}
  }
});
test('invalid model data, owner revocation, daily budget and original-body identity never publish or leak a draft',async()=>{
  const f=setup(async()=>({text:JSON.stringify({...routeFixture().document,lessons:[]}),provider:'synthetic',providerModel:'fixture'}));
  const created=await f.work.create(owner,request(),'work-invalid-original');await f.runner.execute(owner,created.id);
  assert.equal((await f.work.read(owner,created.id)).error_code,'LEARNING_OUTPUT_INVALID');
  await assert.rejects(f.work.create(owner,{...request(),brief:{...routeFixture().brief,title:'Different body'}},'work-invalid-original'),{code:'LIGHTTICK_IDEMPOTENCY_MISMATCH'});
  const second=await f.work.create(owner,request(),'work-before-revocation');
  const a=(await f.native.authority(owner))!;await f.native.consent(owner,{base_revision:a.revision,reading_enabled:false,private_enabled:false},'work-revoke-reading');
  await f.runner.execute(owner,second.id);assert.equal((await f.work.store.get(owner,second.id))?.output,null);
  await assert.rejects(f.work.read(owner,second.id),{statusCode:403});
  const g=setup();await g.work.create(owner,request(),'work-budget-first');await g.work.create(owner,request(),'work-budget-second');
  await assert.rejects(g.work.create(owner,request(),'work-budget-third'),{statusCode:429});
  assert.equal((await g.repo.learningRoutes.listLearningRoutes(owner,'',100)).length,0);
});
test('bounded source collection preserves provenance and file work runs outside owner transactions',async()=>{
  const f=setup();let fetched=0;
  const runner=new LearningWorkRunner(f.work,f.llm,{readFile:async(o,key)=>{assert.equal(o.userId,owner.userId);assert.equal(key,'files/lighttick/synthetic.txt');return 'Owned file content';},
    fetchUrl:async()=>{fetched++;return 'Reviewed page content';},writeFile:async(o,id,name,content)=>({storage_key:'files/lighttick/'+id+'.txt',file_name:name,size_bytes:Buffer.byteLength(content)})});
  const job=await f.work.create(owner,{kind:'collect_sources',route_id:routeId,base_revision:0,sources:[{kind:'file',title:'File',storage_key:'files/lighttick/synthetic.txt'},{kind:'url',title:'URL',url:'https://example.com/source'}]},'work-collect-original');
  await runner.execute(owner,job.id);const result=await f.work.read(owner,job.id);
  assert.equal(result.status,'succeeded');assert.equal(fetched,1);assert.equal(result.output!.sources[0].digest,digest('Owned file content'));
  const file=await f.work.create(owner,{kind:'file_ingest',route_id:routeId,base_revision:0,file_name:'synthetic.txt',content:'Explicit user text'},'work-file-original');
  await runner.execute(owner,file.id);assert.equal((await f.work.read(owner,file.id)).output!.file.file_name,'synthetic.txt');
});
test('cancel polling aborts supported model transport without accepting a late completion',async()=>{
 const started=signal(),aborted=signal();
 const f=setup(async input=>{started.resolve();return new Promise((_,reject)=>{input.signal.addEventListener('abort',()=>{aborted.resolve();reject(Error('Transport cancelled'));},{once:true});});});
 const job=await f.work.create(owner,request(),'work-transport-cancel'),running=f.runner.execute(owner,job.id);await started.promise;
 const current=await f.work.read(owner,job.id);await f.work.cancel(owner,job.id,{base_revision:current.revision},'work-transport-stop');
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{await Promise.race([Promise.all([running,aborted.promise]),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Cancellation did not abort model transport')),2500);})]);}finally{if(timer)clearTimeout(timer);}
 assert.equal((await f.work.read(owner,job.id)).status,'cancelled');assert.equal((await f.work.read(owner,job.id)).output,null);
});

test('final commit rejects membership revocation and a lease expiring during authorization',async()=>{
 for(const expire of [false,true]){
  const f=setup();let checks=0;
  const runner=new LearningWorkRunner(f.work,f.llm,f.runner.sources,async()=>{
   if(++checks===3){if(expire)f.advance(60000);else throw Object.assign(Error('Membership revoked'),{statusCode:403});}
  });
  const job=await f.work.create(owner,request(),'work-final-authorization');await runner.execute(owner,job.id);
  const current=await f.work.read(owner,job.id);assert.equal(current.output,null);
  assert.equal(current.status,expire?'running':'failed');
  if(expire){await f.runner.execute(owner,job.id);assert.equal((await f.work.read(owner,job.id)).attempt,2);}
  else assert.equal(current.error_code,'LEARNING_CONTEXT_STALE');
 }
});
