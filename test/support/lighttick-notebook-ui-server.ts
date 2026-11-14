/** Local synthetic notebook acceptance server. No real accounts or model/GitHub requests. */
import {createServer} from "node:http";
import {pathToFileURL} from "node:url";
import {join} from "node:path";
import {Pool} from "pg";
import {createApplication} from "./create-test-application.ts";
import {buildDefaultSeed} from "../../src/infrastructure/database/prisma/default-seed.ts";
import {PostgresLightTickRepository} from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import {runPostgresMigrations} from "../../src/infrastructure/database/postgres/migrate.ts";
import {NativeLearningService} from "../../src/modules/lighttick/learning/native-learning.service.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL,webRoot=process.env.LIGHTTICK_TEST_WEB_ROOT;
if(!dsn || !webRoot || new URL(dsn).hostname!=="127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_notebook_"))throw Error("Dedicated synthetic notebook database and Web root required");
await runPostgresMigrations({connectionString:dsn,log:()=>{}});
const pool=new Pool({connectionString:dsn}),repo=new PostgresLightTickRepository(pool);
const owner={appId:"lighttick" as const,userId:"user_alice"},seed=buildDefaultSeed(undefined,{includeLightTick:true});
seed.appUsers.push({...owner,id:"notebook-browser",status:"ACTIVE",accountRegion:"UNKNOWN",joinedAt:new Date().toISOString()});
const config=seed.appConfigs.find(c=>c.appId==="lighttick" && c.configKey==="admin.delivery_config")!;
const value=JSON.parse(config.configValue);config.configValue=JSON.stringify({...value,settings:{...value.settings,runtimeScope:"core"}});
const runtime=await createApplication({seed,lighttickEnabled:true,lighttickRepository:repo});
await repo.deleteOwnerData(owner);
let seedClock:Date|null=new Date("2026-11-14T08:00:00Z");
const native=new NativeLearningService(repo,true,()=>seedClock ?? new Date());runtime.services.lighttickRuntime!.nativeLearning=native;
await native.saveCollection(owner,"notebook-english",{base_revision:0,title:"英文课程",module_id:"english-reading",archived:false},"browser-collection-en");
await native.saveCollection(owner,"notebook-expression",{base_revision:0,title:"表达课程",module_id:"structured-expression",archived:false},"browser-collection-ex");
// The real catalog's first 50 lessons deliberately contain no notebook matches.
for(let i=1;i<=51;i++)await native.publish(owner,"lesson-aaa-empty-"+String(i).padStart(3,"0"),{base_revision:0,collection_id:"notebook-english",number:i,title:"目录课节 "+i,content:"# 目录正文",references:""},"browser-empty-"+i);
for(let i=1;i<=30;i++){
 seedClock=new Date(Date.UTC(2026,10,14,8,i));
 const english=i<=26,id="lesson-notebook-ui-"+String(i).padStart(3,"0");
 const lesson=await native.publish(owner,id,{base_revision:0,collection_id:english?"notebook-english":"notebook-expression",number:100+i,title:(english?"英文笔记课 ":"表达笔记课 ")+i,content:i===26?"# 旧版本正文\n保留原版笔记":"# 课程正文 "+i,references:""},"browser-publish-"+i);
 await native.privateCommand(owner,id,{action:"save",content_version:lesson.content_version,base_revision:0,notes:i===25?"":english?"可回查 "+(i===26?"旧版笔记 ":"")+i:"表达草稿 "+i,answers:[{id:"practice",prompt:"练习答案",answer:i===25?"可回查 只有答案":""}]},"browser-notes-"+i);
 if(i===26)await native.publish(owner,id,{base_revision:1,collection_id:"notebook-english",number:100+i,title:"改版课程 26",content:"# 改版后的正文",references:""},"browser-republish-26");
}
seedClock=null;
const {createServer:createVite}=await import(pathToFileURL(join(webRoot,"node_modules/vite/dist/node/index.js")).href);
const vite=await createVite({configFile:false,root:webRoot,base:"/grow/",server:{middlewareMode:true},appType:"spa"});
let fail=false;
const server=createServer(async(req,res)=>{
 const url=new URL(req.url!,"http://127.0.0.1:3189");
 try{
  if(url.pathname.startsWith("/__notebook/")){
   res.setHeader("content-type","application/json");
   if(url.pathname.endsWith("/fail"))fail=true;
   if(url.pathname.endsWith("/recover"))fail=false;
   if(url.pathname.endsWith("/revoke") || url.pathname.endsWith("/grant")){
    const a=(await repo.getLearningAuthority(owner))!;await repo.saveLearningAuthority({...a,privateEnabled:url.pathname.endsWith("/grant"),revision:a.revision+1},a.revision);
   }
   if(url.pathname.endsWith("/snapshot")){
    const lessons=await repo.listNativeLessons(owner,"",200);const row=lessons.find(l=>l.id==="lesson-notebook-ui-006")!;
    const state=await repo.getNativePrivateState(owner,row.id,row.publishedVersion!);
    res.end(JSON.stringify({completed:state?.completed,notes:state?.notes}));return;
   }
   res.end("{}");return;
  }
  if(!url.pathname.startsWith("/api/")){vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});return;}
  res.setHeader("content-type","application/json");res.setHeader("cache-control","no-store");
  if(url.pathname==="/api/v1/auth/refresh"){res.end(JSON.stringify({code:"OK",message:"",requestId:"fixture",data:{accessToken:runtime.services.tokenService.issueAccessToken(owner.userId,"lighttick"),user:{id:owner.userId,displayName:"笔记验收账号"}}}));return;}
  if(fail && url.pathname==="/api/v1/lighttick/learning/notes"){res.statusCode=503;res.end(JSON.stringify({code:"LIGHTTICK_APP_DISABLED",message:"Synthetic notebook read failure",data:null}));return;}
  let raw="";for await(const chunk of req)raw+=chunk;
  const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
  const result=await runtime.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined} as any);
  res.statusCode=result.statusCode;res.end(JSON.stringify(result.body));
 }catch(error){res.statusCode=500;res.end(JSON.stringify({code:"FIXTURE_FAILURE",message:(error as Error).message,data:null}));}
});
server.listen(3189,"127.0.0.1",()=>console.log("Notebook UI fixture ready http://127.0.0.1:3189/grow/learning-notes"));
