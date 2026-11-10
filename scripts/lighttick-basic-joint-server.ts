// Loopback-only synthetic native UI acceptance. Never imported by runtime entry points.
import http from "node:http";
import { coreUIControls } from "../test/support/lighttick-core-ui-controls.ts";
import { createAdminServer } from "../apps/admin-web/server.ts";
import { ManualPlanningService } from "../src/modules/lighttick/manual/manual-planning.service.ts";
import { createApplication } from "../src/app.module.ts";
import { PostgresDatabase } from "../src/infrastructure/database/postgres/postgres-database.ts";
import { KVManager } from "../src/infrastructure/kv/kv-manager.ts";
import { resolveBodyLogStores } from "../src/application-bodylog-stores.ts";
import { writeFileSync } from "node:fs";
import { buildDefaultSeed } from "../src/infrastructure/database/prisma/default-seed.ts";
const closeout = process.argv.includes("--core-closeout");
const coreMatrix = closeout || process.argv.includes("--core-matrix");
const ports = closeout
  ? { api:3127, web:3138, native:3126, postgres:"58681", redis:58686 }
  : { api:3107, web:coreMatrix?3118:3108, native:3106, postgres:"58671",
      redis:coreMatrix?58676:process.argv.includes("--with-web")?58674:58672 };
const withWeb = coreMatrix || process.argv.includes("--with-web");
const expectedDatabase = closeout ? "/joint_core_closeout_qa" : coreMatrix ? "/joint_core_matrix_qa" : withWeb ? "/joint_three_surface_qa" : "/joint_acceptance_qa";
const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (url.hostname !== "127.0.0.1" || url.port !== ports.postgres || url.pathname !== expectedDatabase)
  throw Error(`Requires disposable loopback ${expectedDatabase} on ${ports.postgres}.`);
const enabled = process.argv.includes("--enabled");
const seed = buildDefaultSeed(undefined, { includeLightTick: true, includeFrogSleep: true });
const now = new Date().toISOString();
seed.apps.push({id:"bodylog",code:"bodylog",name:"BodyLog",nameI18n:{"en-US":"BodyLog"},status:"ACTIVE",apiDomain:"bodylog.example.test",joinMode:"AUTO",createdAt:now});
for (const appId of ["lighttick","frogsleep","bodylog","ai_novel"])
  for (const userId of ["user_alice","user_bob"])
    seed.appUsers.push({id:`joint-${appId}-${userId}`,appId,userId,status:"ACTIVE",accountRegion:"GLOBAL",joinedAt:now});
const delivery=seed.appConfigs.find(c=>c.appId==="lighttick"&&c.configKey==="admin.delivery_config")!;
const config=JSON.parse(delivery.configValue);
config.enabled=enabled;
config.minimumClientVersions={ios:"0.1.0",android:"0.1.0"};
config.featureFlags={guestSessions:true,accountUpgrade:true,offlineSync:true,notifications:false,aiPlanning:false};
config.settings.runtimeScope="core";
delivery.configValue=JSON.stringify(config);
const redisUrl=`redis://127.0.0.1:${ports.redis}`;
const kvManager=await KVManager.create({redisUrl});
const app=await createApplication({seed,lighttickEnabled:enabled,lighttickSeedEnabled:true,frogsleepEnabled:true,
  appEnvironment:"test",kvManager,queueBackend:"redis",queueRedisUrl:redisUrl,
  databaseFactory:seed=>PostgresDatabase.create(databaseUrl,seed),fileStorageRoot:process.env.JOINT_FILE_ROOT});
await app.database.upsertAppConfig(delivery);
const repository=app.services.lighttickRepository;
const stores=resolveBodyLogStores(app.database);
await stores.flags.updateBodyLogFeatureFlag("accountSocial",true);
// Simulate a previously accepted advanced queue envelope; core must defer it.
// No provider or generation fallback is installed by this acceptance fixture.
if(enabled)await app.queue.add("lighttick.ai.run",{app_id:"lighttick",user_id:"user_bob",run_id:"joint-preexisting-run",scene:"planning"},{jobId:"joint-deferred-ai",attempts:3});
for(const userId of ["user_alice","user_bob"])
  await app.database.upsertBodyLogProfile({appId:"bodylog",userId,nickname:"Joint QA",avatarKey:"mint_runner",profileCompleted:true,createdAt:now,updatedAt:now});
// Only public response fixtures, no token/cookie/session data are persisted.
const publicConfig=await app.app.handle({method:"GET",path:"/api/v1/lighttick/public/config",headers:{}});
if(process.env.JOINT_CONFIG_FILE)writeFileSync(process.env.JOINT_CONFIG_FILE,JSON.stringify(publicConfig.body,null,2));
const owner = { appId: "lighttick" as const, userId: "user_alice" };
let offline = false,
  dropNext = "",
  nativePhase = "";
const core = coreMatrix ? coreUIControls(app,owner) : undefined;
const manual = new ManualPlanningService(repository);
let web: ReturnType<typeof http.createServer> | undefined;
if (withWeb) {
  const frontend = createAdminServer({proxyTarget:`http://127.0.0.1:${ports.api}`,growEnabled:true,growRoot:"static/grow"});
  web = http.createServer(async (request,response) => {
    if (request.url === "/__native-web-manifest") {
      try {
        response.setHeader("Content-Type","application/json");
        response.setHeader("Cache-Control","no-store");
        response.end(JSON.stringify({account:"alice@example.com",plans:await manual.list(owner)}));
      } catch {response.statusCode=500;response.end("{}");}
      return;
    }
    frontend.emit("request",request,response);
  });
  await new Promise<void>(resolve=>web!.listen(ports.web,"127.0.0.1",resolve));
}
const requests: { method: string; path: string; status: number }[] = [];
const workerStats={ticks:0,otherJobs:0,errors:0};
let ticking=false;
const workerTimer=setInterval(async()=>{
 if(ticking)return;ticking=true;
 try {
  if(enabled)await app.services.lighttickRuntime.worker?.recover();
  await app.services.notificationService.queueNotification({appId:"ai_novel",recipientUserId:"user_bob",channel:"email",payload:{subject:"Local synthetic acceptance"}});
  await app.queue.processDueJobs(async job=>{
   if(job.name.startsWith("lighttick.")) await app.services.lighttickRuntime.worker?.process(job);
   else {await app.services.notificationService.processQueueJob(job);workerStats.otherJobs++;}
  });workerStats.ticks++;
 }catch{workerStats.errors++;}finally{ticking=false;}
},1000);

const server = http.createServer(async (req, res) => {
  try {
    const target = new URL(req.url ?? "/", `http://127.0.0.1:${ports.api}`);
    if(core && (target.pathname==="/__online" || target.pathname==="/__offline" && target.searchParams.get("value")==="0"))offline=false;
    const controlled = await core?.handle(target);
    if(controlled!==undefined){res.setHeader("Content-Type","application/json");res.end(JSON.stringify(controlled));return;}
    if(target.pathname==="/__worker") {res.end(JSON.stringify(workerStats));return;}
    if (target.pathname === "/__phase") {
      if (target.searchParams.has("value"))
        nativePhase = target.searchParams.get("value") ?? "";
      res.end(JSON.stringify({ phase: nativePhase }));
      return;
    }
    if (target.pathname === "/__reset") {
      await repository.deleteOwnerData(owner);
      offline = false;
      dropNext = "";
      requests.length = 0;
      res.end("{}");
      return;
    }
    if (target.pathname === "/__offline") {
      offline = target.searchParams.get("value") === "1";
      res.end("{}");
      return;
    }
    if (target.pathname === "/__drop-next") {
      dropNext = target.searchParams.get("kind") ?? "confirm";
      res.end("{}");
      return;
    }
    if (target.pathname === "/__state") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          plans: (await repository.listPlans(owner)).map((p) => ({
            id: p.id,
            status: p.status,
            version: p.version,
            goal_id: p.goalId,
          })),
          tasks: (await repository.listTasks(owner)).map((t) => ({
            id: t.id,
            plan_id: t.planId,
            title: t.title,
            status: t.status,
            estimate: t.estimatedMinutes,
            date: t.scheduledFor ?? null,
          })),
          requests,
        }),
      );
      return;
    }
    if (offline || core?.offline) {
      requests.push({
        method: req.method ?? "",
        path: target.pathname,
        status: 503,
      });
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "Synthetic network failure",
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    if(coreMatrix && req.headers.authorization==='Bearer record-ui-only')req.headers.authorization='Bearer '+app.services.tokenService.issueAccessToken(owner.userId,'lighttick');
    const response = await app.app.handle({
      method: req.method as any,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers: { ...req.headers } as any,
      body: raw ? JSON.parse(raw) : undefined,
    });
    requests.push({
      method: req.method ?? "",
      path: target.pathname,
      status: response.statusCode,
    });
    if (
      response.statusCode < 300 &&
      dropNext &&
      (target.pathname.endsWith("/" + dropNext) ||
        (dropNext === "adopt" && target.pathname.endsWith("/local-adoptions")))
    ) {
      dropNext = "";
      offline = true;
      res.destroy();
      return;
    }
    if(response.statusCode<300 && req.method==='POST' && target.pathname==='/api/v1/lighttick/action-plans/practices' && core?.takePracticeDrop()){res.destroy();return;}
    res.writeHead(response.statusCode, {
      ...response.headers,
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(response.body));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        code: "SYNTHETIC_SERVER_FAILURE",
        message: String(error),
      }),
    );
  }
});
let native: ReturnType<typeof http.createServer> | undefined;
if(coreMatrix){
 native=http.createServer((req,res)=>{const proxy=http.request({hostname:'127.0.0.1',port:ports.api,path:req.url,method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode??500,reply.headers);reply.pipe(res);});proxy.on('error',()=>{res.statusCode=502;res.end();});req.pipe(proxy);});
 await new Promise<void>(resolve=>native!.listen(ports.native,'127.0.0.1',resolve));
}
server.listen(ports.api, "127.0.0.1", () =>
  process.stdout.write(
    `Basic joint acceptance: loopback ${ports.api}; complete PostgreSQL + Redis; core scope.\n`,
  ),
);
for(const signal of ["SIGINT","SIGTERM"] as const)process.on(signal,()=>{clearInterval(workerTimer);web?.close();native?.close();server.close(async()=>{await app.close();await kvManager.disconnect();process.exit(0);});});
