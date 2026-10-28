/** Ephemeral, loopback-only integration server for the real app UI and Admin.
 * Uses the production application factory with in-memory persistence; no external
 * notification provider, account deletion, production config or clock changes.
 */
import {createServer} from "node:http";
import {writeFile} from "node:fs/promises";
import {buildDefaultSeed} from "../src/infrastructure/database/prisma/default-seed.ts";
import {InMemoryDatabase} from "../src/testing/in-memory-database.ts";
import {createApplication} from "../src/app.module.ts";
import {resolveBodyLogStores} from "../src/application-bodylog-stores.ts";
const seed=buildDefaultSeed();
const now=new Date().toISOString();
seed.apps!.push({id:"bodylog",code:"bodylog",name:"BodyLog",nameI18n:{"en-US":"BodyLog","zh-CN":"BodyLog"},status:"ACTIVE",apiDomain:"localhost",joinMode:"AUTO",createdAt:now});
for(const userId of ["user_alice","user_bob"])seed.appUsers!.push({id:`qa_${userId}_bodylog`,appId:"bodylog",userId,status:"ACTIVE",accountRegion:"GLOBAL",joinedAt:now});
const database=new InMemoryDatabase(seed);
const runtime=await createApplication({database,queueBackend:"memory",adminBasicAuth:{username:"reviewer",password:"ReviewPass123!"}});
const stores=resolveBodyLogStores(database);
for(const flag of ["accountSocial","friends","growth","competition"] as const)await stores.flags.updateBodyLogFeatureFlag(flag,true);
for(const [userId,nickname] of [["user_alice","QA Alice"],["user_bob","QA Bob"]])await database.upsertBodyLogProfile({appId:"bodylog",userId,nickname,avatarKey:"mint_runner",profileCompleted:true,createdAt:now,updatedAt:now});
await database.insertBodyLogFriendship({appId:"bodylog",userId:"user_alice",friendUserId:"user_bob",createdAt:now});
const counters:Record<string,number>={};
const server=createServer(async(req,res)=>{
 try {
  const url=new URL(req.url!,"http://127.0.0.1");
  const chunks:Buffer[]=[];for await(const part of req)chunks.push(Buffer.from(part));
  const body=Buffer.concat(chunks).toString();
  counters[`${req.method} ${url.pathname.replace(/\/(i|invite|b|g|invitations)\/.*/,"/$1/[redacted]")}`]=(counters[`${req.method} ${url.pathname.replace(/\/(i|invite|b|g|invitations)\/.*/,"/$1/[redacted]")}`]??0)+1;
  if(url.pathname==="/__qa/counts") {res.writeHead(200,{"Content-Type":"application/json"});res.end(JSON.stringify(counters));return;}
  const handled=await runtime.app.handle({method:req.method as any,path:url.pathname,headers:req.headers as Record<string,string>,query:Object.fromEntries(url.searchParams),body:body?JSON.parse(body):undefined});
  res.writeHead(handled.statusCode,{"Content-Type":handled.contentType??"application/json",...handled.headers});
  if(handled.streamBody){for await(const chunk of handled.streamBody)res.write(chunk);res.end();}
  else res.end(typeof handled.body === "string" ? handled.body : JSON.stringify(handled.body));
 } catch {res.writeHead(500,{"Content-Type":"application/json"});res.end('{"code":"QA_SERVER_ERROR"}');}
});
server.listen(Number(process.env.BODYLOG_QA_PORT??3138),"127.0.0.1",async()=>{
 const port=(server.address() as any).port;
 const ready={baseURL:`http://127.0.0.1:${port}`,persistence:"ephemeral",notificationProviders:"disabled"};
 await writeFile(process.env.BODYLOG_QA_READY_FILE??"/tmp/bodylog-local-acceptance-ready.json",JSON.stringify(ready));
 console.log(JSON.stringify(ready));
});
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>server.close(()=>process.exit(0)));
