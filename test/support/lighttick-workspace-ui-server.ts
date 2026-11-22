/** Local-only synthetic browser fixture. No real credentials or user data. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { GitHubContentService } from "../../src/modules/lighttick/learning/github-content.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
const webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (!dsn || new URL(dsn).hostname !== "127.0.0.1" || !new URL(dsn).pathname.startsWith("/grow_web_u1_") || !webRoot) throw Error("Disposable local fixture required");
const { createServer: createVite } = await import(pathToFileURL(join(webRoot,"node_modules/vite/dist/node/index.js")).href);
const pool = new Pool({ connectionString: dsn });
const repo = new PostgresLightTickRepository(pool);
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
const owner = { appId: "lighttick" as const, userId: "user_alice" };
seed.appUsers.push({ ...owner, id: "workspace-browser", status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
process.env.LIGHTTICK_NATIVE_LEARNING_ENABLED = "1";
const runtime = await createApplication({ seed, lighttickEnabled: true, lighttickRepository: repo });
await repo.deleteOwnerData(owner);
const github = runtime.services.lighttickRuntime!.github!;
github.summary = async () => ({ mode: "custom", configured: true, revision: 1, repository: "fixture/content", branch: "main", updated_at: null, storage: "account_encrypted" }) as any;
github.credentials = async () => ({ repository: "fixture/content", branch: "main", token: "synthetic-browser-only" });
github.assertCurrent = async () => {};
// Stub only the external GitHub boundary. HTTP auth, routes, receipts and SQL stay real.
GitHubContentService.prototype.getLatestCommit = async () => "b".repeat(40);
GitHubContentService.prototype.listFiles = async () => [{ path: "first.md", content: "", sha: "fixture-blob", size: 80 }];
GitHubContentService.prototype.readText = async () => "# 浏览器同步课程\n\n这是从指定 GitHub 提交导入的中文正文。";
const call = async (method: string, path: string, body?: unknown) => {
  const result = await runtime.app.handle({ method, path: "/api/v1/lighttick/" + path, body, headers: {
    authorization: "Bearer " + runtime.services.tokenService.issueAccessToken(owner.userId,"lighttick"), "x-app-id":"lighttick", "x-lighttick-task-schema":"2", "idempotency-key":randomUUID() } } as any);
  if (result.statusCode >= 400) throw Error(JSON.stringify(result.body));
  return result.body.data as any;
};
const today = (await call("GET","today")).business_date;
const goal = await call("POST","goals",{title:"浏览器验收目标",description:"",source_type:"user_input"});
const plan = await call("POST","manual-plans",{goal_id:goal.id,title:"浏览器验收计划",completion_criteria:"完成一个小行动",period_start:today,period_end:today,tasks:[{id:randomUUID(),title:"搜索定位任务",scheduled_for:today,estimated_minutes:10,completion_criteria:"有一个结果",guidance:"先写一句话"}]});
await call("POST",`manual-plans/${plan.id}/confirm`,{base_version:plan.version,goal_base_version:plan.goal_version});
await call("PUT","records/record-browser-search",{raw_text:"搜索定位记录正文",record_date:today,prompt_kind:"free",guided_answers:{},tags:[],base_version:0});
const vite = await createVite({ configFile: false, root: webRoot, base:"/grow/",server:{ middlewareMode:true },appType:"spa" });
let dropNext = false;
const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,"http://127.0.0.1:3188");
  try {
    if(url.pathname==="/__drop_next") {dropNext=true;res.end("ok");return;}
    if(url.pathname==="/__release_drop") {dropNext=false;res.end("ok");return;}
    if(!url.pathname.startsWith("/api/")) {vite.middlewares(req,res,()=>{res.statusCode=404;res.end();});return;}
    res.setHeader("content-type","application/json");res.setHeader("cache-control","no-store");
    if(url.pathname==="/api/v1/auth/refresh") {res.end(JSON.stringify({code:"OK",message:"",requestId:"fixture",data:{accessToken:runtime.services.tokenService.issueAccessToken(owner.userId,"lighttick"),user:{id:owner.userId,displayName:"合成验收账号"}}}));return;}
    let raw="";for await(const chunk of req)raw+=chunk;
    const headers=Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v[0]:v]));
    const result=await runtime.app.handle({method:req.method!,path:url.pathname,query:Object.fromEntries(url.searchParams),headers,body:raw?JSON.parse(raw):undefined} as any);
    if(dropNext && req.method!=="GET") {res.destroy();return;}
    if (result.statusCode >= 400) console.warn("FIXTURE_HTTP",req.method,url.pathname,result.statusCode);
    res.statusCode=result.statusCode;res.end(JSON.stringify(result.body));
  } catch(error) {res.statusCode=500;res.end(JSON.stringify({code:"FIXTURE_FAILURE",message:(error as Error).message,data:null}));}
});
server.listen(3188,"127.0.0.1",()=>console.log("Workspace UI fixture ready at http://127.0.0.1:3188/grow/"));
