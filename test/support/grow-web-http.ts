import {ResearchAIRunner} from "../../src/modules/lighttick/investments/research-ai/research-ai.runner.ts";
import {GitHubService} from "../../src/modules/lighttick/github/github.service.ts";
import {GitHubClient} from "../../src/modules/lighttick/github/github.client.ts";
import {GitHubTestRunner} from "../../src/modules/lighttick/github/github-test.runner.ts";
import {KVManager} from "../../src/infrastructure/kv/kv-manager.ts";
import {PersonalModelDispatcher} from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import {PersonalModelTestRunner} from "../../src/modules/lighttick/personal-model/personal-model-test.runner.ts";
import {MarketWorkRunner} from "../../src/modules/lighttick/investments/market/market-work.runner.ts";
import {DailyMarketAdapter} from "../../src/modules/lighttick/investments/market/market.adapter.ts";
import {MarketTransport} from "../../src/modules/lighttick/investments/market/market.transport.ts";
/** Disposable localhost-only HTTP/PG integration runtime; never imported by production. */
import { LightTickWorker } from '../../src/modules/lighttick/lighttick-worker.ts';
import { LearningWorkRunner } from '../../src/modules/lighttick/learning/learning-work.runner.ts';
import { LightTickAiRunner } from '../../src/modules/lighttick/ai/lighttick-ai-runner.ts';
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { createApplication } from './create-test-application.ts';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { PostgresLightTickRepository } from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import { runPostgresMigrations } from '../../src/infrastructure/database/postgres/migrate.ts';
import { createAdminServer } from '../../apps/admin-web/server.ts';
import { readRequestBody } from '../../src/infrastructure/http/request-body.ts';
const dsn = process.env.GROW_WEB_TEST_DSN;
if (!dsn || !['127.0.0.1', 'localhost'].includes(new URL(dsn).hostname) || !/^\/grow_web_u1_[a-f0-9]+$/.test(new URL(dsn).pathname)) throw Error('Dedicated disposable localhost database required');
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn,application_name:"grow-web-fixture" });
const repository = new PostgresLightTickRepository(pool);
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
for (const userId of ['user_alice', 'user_bob']) seed.appUsers.push({ id: 'grow-web-' + userId, appId: 'lighttick', userId, status: 'ACTIVE', accountRegion: 'UNKNOWN', joinedAt: new Date().toISOString() });
if (process.env.GROW_WEB_TEST_AI === 'synthetic') {
 const template=seed.users.find(u=>u.id==='user_alice')!;
 for(let n=0;n<12;n++){
  const userId='user_course_'+n;
  seed.users.push({...template,id:userId,email:'course'+n+'@example.com',phone:'+86188000010'+String(n).padStart(2,'0')});
  seed.appUsers.push({id:'grow-course-'+n,appId:'lighttick',userId,status:'ACTIVE',accountRegion:'UNKNOWN',joinedAt:new Date().toISOString()});
 }
 const config=seed.appConfigs.find(c=>c.appId==='lighttick'&&c.configKey==='admin.delivery_config')!;
 const value=JSON.parse(config.configValue);value.enabled=true;value.investment_market={providers:{csv:{enabled:true},eastmoney:{enabled:true},tushare:{enabled:false},tencent:{enabled:false}}};value.featureFlags.conversationalPlanning=true;config.configValue=JSON.stringify(value);
 if(process.env.GROW_WEB_TEST_PORT){value.settings={...value.settings,growWebUrl:'http://127.0.0.1:'+process.env.GROW_WEB_TEST_PORT+'/grow/'};config.configValue=JSON.stringify(value);}
}
const modelRedis=process.env.GROW_WEB_MODEL_TEST_REDIS_URL;
if(modelRedis&&(new URL(modelRedis).hostname!=='127.0.0.1'||new URL(modelRedis).port!=='58632'))throw Error('Dedicated synthetic model Redis required');
const fixtureKv=modelRedis?await KVManager.create({redisUrl:modelRedis}):undefined;
const app = await createApplication({ ...(fixtureKv?{kvManager:fixtureKv}:{}), adminBasicAuth:{username:"fixture-market-admin",password:"synthetic-market-password"},adminSensitiveOperation:{secondaryPassword:"199510"},seed, lighttickEnabled: true, lighttickRepository: repository, secureRefreshCookie: false, refreshCookieSameSite: 'Lax', fileStorageRoot: '.artifacts/grow-unified-20261103/fixture-files' });
let queueTimer: ReturnType<typeof setInterval> | undefined;
if (process.env.GROW_WEB_TEST_AI === 'synthetic') {
  const runtime = app.services.lighttickRuntime!;
  runtime.planningEnabled = true;
  const llm={complete:async(input:any)=>{
   const user=String(input.messages.at(-1)?.content??'');
   if(user.includes('Draft a formal curriculum')){
    const context=JSON.parse(user.split('INPUT_JSON=').at(-1)!);
    if(context.brief.title.includes('慢任务'))await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,10000);input.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Synthetic cancelled'));},{once:true});});
    const count=context.brief.pacing==='weekly'?context.brief.weeks*context.brief.sessions:context.brief.lesson_count;
    return {provider:'synthetic',providerModel:'fixture',text:JSON.stringify({prerequisites:'合成先修说明',stages:[{title:'合成基础',goal:'解释合成概念'}],lessons:Array.from({length:count},(_,i)=>context.frozen?.find((l:any)=>l.number===i+1)??{number:i+1,topic:'合成课次 '+(i+1),goal:'说明具体结论',exercise:'写下一条应用',assessment:'自查证据',minutes:context.brief.minutes,stage:1,kind:i===count-1?'review':'lesson',requires:i?[i]:[]})})};
   }
   if(user.includes('LIGHTTICK_RESEARCH_AI_V1')){const frozen=JSON.parse(user.slice(user.lastIndexOf('\n')+1));return {provider:'synthetic',providerModel:'fixture',...(frozen.research.title.includes('TRUNCATED_RESPONSE')?{finishReason:'length'}:{}),text:JSON.stringify({text:'Synthetic '+(/KIND=(analysis|guide|report)/.exec(user)?.[1]??'unknown')+' reviewed document',limitations:'No live quotes. Synthetic verification only.',citations:frozen.research.title.includes('BAD_CITATION')?['invented']:['research:'+frozen.research.id+':'+frozen.research.revision]})};}
   if(user.includes('Draft one complete lesson'))return {provider:'synthetic',providerModel:'fixture',text:JSON.stringify({content:'# 合成教学正文\n## 引导问题\n合成问题\n## 概念\n概念\n## 示范\n示范\n## 边界\n边界\n## 练习\n写下一条应用\n---\n## 参考分析\n核对证据\n## 自查\n自查\n## 记忆提示\n提示',references:'仅使用明确审阅的合成资料'})};
   return { provider: 'synthetic', providerModel: 'synthetic', text: JSON.stringify(input.messages.some((m: any) => m.content.includes('"planning_action":"messages"')) ? {message: '请核对投入与日期，再审阅草案。',fields: {}} : {tasks: [{title:'合成规划步骤',estimated_minutes:5,scheduled_for:'2030-01-01T09:00:00Z',completion_criteria:'写下一条具体结论',steps:['打开笔记','写下结论']}]}) };
  }} as any;
  const personal=new PersonalModelDispatcher(runtime.personalModel!,llm,async(raw,init,signal)=>{
    const url=new URL(raw),credential=new Headers(init.headers).get('Authorization')??'';
    if(url.hostname!=='personal-model.example.invalid'||!credential.startsWith('Bearer SYNTHETIC_'))throw Error('Synthetic personal model endpoint and key required');
    const body=JSON.parse(String(init.body));
    if(String(body.model).includes('slow'))await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,10000);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Synthetic cancelled'));},{once:true});});
    if(String(body.model).includes('failed'))return new Response(JSON.stringify({error:{message:'Synthetic provider rejected request'}}),{status:503});
    const result=body.messages.some((m:any)=>m.content.includes('connection test'))?{text:'OK'}:await llm.complete({messages:body.messages,signal});
    return new Response(JSON.stringify({choices:[{message:{content:result.text},finish_reason:String(body.model).includes('truncated')?'length':'stop'}],usage:{prompt_tokens:10,completion_tokens:10,total_tokens:20}}),{headers:{'Content-Type':'application/json'}});
  });
  runtime.personalModelDispatcher=personal;
  const githubBase=runtime.github!;
  const github=new GitHubService(repository,githubBase.crypto,githubBase.keyId,app.queue,new GitHubClient(async(raw,init)=>{
    const u=new URL(String(raw)),token=new Headers(init?.headers).get('Authorization')??'';
    if(u.origin!=='https://api.github.com'||!u.pathname.startsWith('/repos/fixture/')||!token.startsWith('Bearer SYNTHETIC_'))throw Error('Synthetic GitHub fixture only');
    const branch=decodeURIComponent(u.pathname.split('/git/ref/heads/')[1]??'');
    if(branch.includes('slow'))await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,10000);init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Synthetic cancelled'));},{once:true});});
    if(branch.includes('failed'))return new Response('{}',{status:403});
    return new Response(JSON.stringify({ref:'refs/heads/'+branch,object:{type:'commit',sha:'a'.repeat(40)}}),{headers:{'Content-Type':'application/json'}});
  }));
  runtime.github=github;
  const learning=runtime.worker!.learning!;
  const market=new MarketWorkRunner(runtime.marketWork!,new DailyMarketAdapter(s=>runtime.marketPolicy!.policy(s),new MarketTransport(async(url,init)=>{if(new URL(String(url)).searchParams.get('beg')==='20261029')await new Promise<void>((resolve,reject)=>{const timer=setTimeout(resolve,10000);init?.signal?.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('Synthetic cancelled'));},{once:true});});return new Response('{"synthetic":"unavailable"}',{status:503});})),runtime.worker!.market!.authorizeOwner);
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repository,personal),undefined,new LearningWorkRunner(runtime.learningWork!,personal,{...learning.sources,fetchUrl:async()=> '合成页面资料，来源与摘要在任务中保留。'},learning.authorizeOwner),runtime.worker!.investments,market,new PersonalModelTestRunner(runtime.personalModel!,personal,runtime.worker!.modelTests!.authorizeOwner),new GitHubTestRunner(github,runtime.worker!.githubTests!.authorizeOwner),new ResearchAIRunner(runtime.researchAI!,personal,runtime.worker!.researchAI!.authorizeOwner));
  let running=false,lastRecovery=0;
  queueTimer=setInterval(()=>{if(running)return;running=true;void (async()=>{if(Date.now()-lastRecovery>1000){lastRecovery=Date.now();await runtime.worker!.recover();}await app.queue.processDueJobs(job=>runtime.worker!.process(job),new Date());})().catch(()=>{}).finally(()=>{running=false;});},100);

}
const api = createServer(async (request, response) => {
  try {
    const url = new URL(request.url!, 'http://127.0.0.1');
    const result = await app.app.handle({ method: request.method!, path: url.pathname, query: Object.fromEntries(url.searchParams), headers: Object.fromEntries(Object.entries(request.headers).map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])), body: await readRequestBody(request, request.headers['content-type']), ipAddress: '127.0.0.1' });
    response.writeHead(result.statusCode, { 'Content-Type': 'application/json', ...result.headers }); response.end(JSON.stringify(result.body));
  } catch { response.writeHead(500); response.end('{"code":"FIXTURE_FAILED"}'); }
});
await new Promise<void>(resolve => api.listen(0, '127.0.0.1', resolve));
const address = api.address(); if (!address || typeof address === 'string') throw Error('Missing address');
const web = createAdminServer({ proxyTarget: 'http://127.0.0.1:' + address.port, growEnabled: true, growRoot: 'static/grow' });
await new Promise<void>(resolve => web.listen(Number(process.env.GROW_WEB_TEST_PORT ?? 0), '127.0.0.1', resolve));
const webAddress = web.address();
console.log(JSON.stringify({ ready: true, api: 'http://127.0.0.1:' + address.port, web: 'http://127.0.0.1:' + (typeof webAddress === 'object' && webAddress ? webAddress.port : 0) }));
async function close() { if(queueTimer)clearInterval(queueTimer); web.closeAllConnections(); api.closeAllConnections(); web.close(); api.close(); await pool.end(); await fixtureKv?.disconnect(); process.exit(0); }
process.once('SIGTERM', close); process.once('SIGINT', close);
