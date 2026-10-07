// Loopback-only deterministic native acceptance server; never imported by production.
import http from 'node:http';
import { createApplication } from '../test/support/create-test-application.ts';
import { buildDefaultSeed } from '../src/infrastructure/database/prisma/default-seed.ts';
import { LightTickWorker } from '../src/modules/lighttick/lighttick-worker.ts';
import { LightTickAiRunner } from '../src/modules/lighttick/ai/lighttick-ai-runner.ts';
const seed=buildDefaultSeed(undefined,{includeLightTick:true});
seed.appUsers.push({id:'reflection-ui-member',appId:'lighttick',userId:'user_alice',status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
const app=await createApplication({seed,lighttickEnabled:true});const rt=app.services.lighttickRuntime;
const owner={appId:'lighttick' as const,userId:'user_alice'};let offline=false;
rt.worker=new LightTickWorker(new LightTickAiRunner(rt.repository,{complete:async()=>({provider:'deterministic-ui-test',providerModel:'fake',text:JSON.stringify({insights:['本周期已经开始阅读；未完成事项仍可调整。'],recommendations:['下一步整理一条阅读笔记，先审核再加入计划。']})})} as any));
async function reset(){
 offline=false;await rt.repository.deleteOwnerData(owner);const now=new Date().toISOString();
 await rt.repository.saveGoal({...owner,id:'reflection-ui-goal',title:'一个月阅读计划',status:'active',constraints:{},version:1,createdAt:now,updatedAt:now},
 {event:{...owner,id:'reflection-ui-event',aggregateType:'goal',aggregateId:'reflection-ui-goal',eventType:'goal_created',aggregateVersion:1,payload:{},occurredAt:now,createdAt:now},change:{...owner,entityType:'goal',entityId:'reflection-ui-goal',entityVersion:1,operation:'upsert',snapshot:{},changedAt:now}});
 const day=now.slice(0,10);const p=await rt.plans.createProposed(owner,{goalId:'reflection-ui-goal',granularity:'day',source:'test',periodStart:day,periodEnd:day,tasks:[{title:'阅读一章',estimatedMinutes:10,scheduledFor:day}]});await rt.plans.confirm(owner,p.id,1);
}
await reset();
http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url!,'http://127.0.0.1');
  if(url.pathname==='/__reset'){await reset();res.end('{}');return;}
  if(url.pathname==='/__offline'){offline=url.searchParams.get('value')==='1';res.end('{}');return;}
  if(offline){res.writeHead(503,{'Content-Type':'application/json'});res.end('{"code":"UNAVAILABLE"}');return;}
  let text='';for await(const chunk of req)text+=chunk;
  const result=await app.app.handle({method:req.method as any,path:url.pathname,query:Object.fromEntries(url.searchParams),
   headers:{...req.headers,authorization:'Bearer '+app.services.tokenService.issueAccessToken(owner.userId,'lighttick')} as any,body:text?JSON.parse(text):undefined});
  res.writeHead(result.statusCode,{'Content-Type':'application/json'});res.end(JSON.stringify(result.body));
  await app.queue.processDueJobs(job=>rt.worker!.process(job),new Date('2030-01-01'));
 }catch{res.writeHead(500);res.end('{"code":"TEST_SERVER_FAILURE"}');}
}).listen(3105,'127.0.0.1',()=>process.stdout.write('Reflection UI server: loopback 3105, deterministic provider.\n'));
