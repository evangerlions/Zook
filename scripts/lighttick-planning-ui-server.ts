// Local-only deterministic acceptance server. Never used by production entry points.
import http from "node:http";
import {createApplication} from "../test/support/create-test-application.ts";
import {buildDefaultSeed} from "../src/infrastructure/database/prisma/default-seed.ts";
import {LightTickWorker} from "../src/modules/lighttick/lighttick-worker.ts";
import {LightTickAiRunner} from "../src/modules/lighttick/ai/lighttick-ai-runner.ts";
const seed=buildDefaultSeed(undefined,{includeLightTick:true});
seed.appUsers.push({id:"planning-ui-member",appId:"lighttick",userId:"user_alice",status:"ACTIVE",accountRegion:"UNKNOWN",joinedAt:new Date().toISOString()});
const runtime=await createApplication({seed,lighttickEnabled:true});
const lighttick=runtime.services.lighttickRuntime;lighttick.planningEnabled=true;
const owner={appId:"lighttick" as const,userId:"user_alice"};
lighttick.worker=new LightTickWorker(new LightTickAiRunner(lighttick.repository,{complete:async(input:any)=>{
  const clarify=input.messages[1].content.includes('"fields"');
  const adjusted=input.messages[1].content.includes("五分钟");
  return {provider:"acceptance-fake",providerModel:"fake",text:JSON.stringify(clarify?{message:"已记下你的成果要求，请确认摘要后生成草案。",fields:{outcome:"可运行的小示例"}}:{tasks:[{title:adjusted?"完成五分钟小练习":"运行一个小示例并保存结果",estimated_minutes:adjusted?5:10}]})};
}} as any));
let offline=false,disconnect=false;
async function reset(){
 offline=false;disconnect=false;
 await lighttick.repository.deleteOwnerData(owner);
 const now=new Date().toISOString();
 await lighttick.repository.saveGoal({...owner,id:"planning-ui-goal",title:"做出一个可运行的小示例",status:"active",constraints:{weekly_available_minutes:30},version:1,createdAt:now,updatedAt:now},{event:{...owner,id:"ui-event",aggregateType:"goal",aggregateId:"planning-ui-goal",eventType:"goal_created",aggregateVersion:1,payload:{},occurredAt:now,createdAt:now},change:{...owner,entityType:"goal",entityId:"planning-ui-goal",entityVersion:1,operation:"upsert",snapshot:{},changedAt:now}});
}
await reset();
http.createServer(async(req,res)=>{
 try{
 const url=new URL(req.url!,"http://127.0.0.1");
 if(url.pathname==="/__reset"){await reset();res.end("{}");return;}
 if(url.pathname==="/__disconnect"){disconnect=url.searchParams.get("value")==="1";res.end("{}");return;}
 if(url.pathname==="/__offline"){offline=url.searchParams.get("value")==="1";res.end("{}");return;}
 if(url.pathname==="/__conflict"){
  const goal=await lighttick.repository.getGoal(owner,"planning-ui-goal");
  await lighttick.goals.update(owner,goal!.id,goal!.version,{title:goal!.title+"（更新）"});
  res.end("{}");return;
 }
 if(url.pathname==="/__state"){res.setHeader("Content-Type","application/json");res.end(JSON.stringify({tasks:(await lighttick.repository.listTasks(owner)).length,plans:(await lighttick.repository.listPlans(owner)).length}));return;}
 if(disconnect){res.destroy();return;}
 if(offline){res.writeHead(503,{"Content-Type":"application/json"});res.end(JSON.stringify({code:"LIGHTTICK_AI_UNAVAILABLE",message:"Fixture service unavailable"}));return;}
 let body="";for await(const chunk of req)body+=chunk;
 const token=runtime.services.tokenService.issueAccessToken(owner.userId,"lighttick");
 const response=await runtime.app.handle({method:req.method as any,path:url.pathname,query:Object.fromEntries(url.searchParams),headers:{...req.headers,authorization:"Bearer "+token} as any,body:body?JSON.parse(body):undefined});
 res.writeHead(response.statusCode,{"Content-Type":"application/json"});res.end(JSON.stringify(response.body));
 await runtime.queue.processDueJobs(job=>lighttick.worker!.process(job),new Date("2030-01-01"));
 }catch(e){res.writeHead(500);res.end(JSON.stringify({code:"TEST_SERVER_FAILURE"}));}
}).listen(3104,"127.0.0.1",()=>process.stdout.write("Local planning acceptance server on 3104; deterministic provider only.\n"));
