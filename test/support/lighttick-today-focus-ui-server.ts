import {LightTickTodayService} from "../../src/modules/lighttick/lighttick-today.service.ts";
import {seedTodayFocus} from "./today-focus-fixture.ts";
/** Local synthetic today-focus acceptance server. No real accounts or model/GitHub requests. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_today_focus_")
)
  throw Error(
    "Dedicated synthetic today-focus database and Web root required",
  );
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool);
const owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...owner,
  id: "today-focus-browser",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: new Date().toISOString(),
});
const config = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const value = JSON.parse(config.configValue);
config.configValue = JSON.stringify({
  ...value,
  settings: { ...value.settings, runtimeScope: "core" },
});
const runtime = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
await repo.deleteOwnerData(owner);
let clock=new Date("2026-11-15T08:00:00Z");
runtime.services.lighttickRuntime!.today=new LightTickTodayService(repo,()=>clock);
runtime.services.lighttickRuntime!.nativeLearning.enabled=true;
const f=await seedTodayFocus(runtime);
const { createServer: createVite } = await import(
  pathToFileURL(join(webRoot, "node_modules/vite/dist/node/index.js")).href
);
const vite = await createVite({
  configFile: false,
  root: webRoot,
  base: "/grow/",
  server: { middlewareMode: true },
  appType: "spa",
});
let fail = false,drop=false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3194");
  try {
    if(url.pathname.startsWith("/__today-focus/")){
      res.setHeader("content-type","application/json");
      const action=url.pathname.split("/").at(-1);
      if(action==="fail")fail=true;if(action==="recover")fail=false;if(action==="drop")drop=true;
      if(action==="tomorrow")clock=new Date("2026-11-16T08:00:00Z");
      if(action==="compete"){
        const current=await f.ok("GET","today/focus"),task=(await f.ok("GET","today")).tasks[0];
        await f.ok("PUT","today/focus",{request_key:"competing-"+Date.now(),base_version:current.revision,business_date:current.business_date,timezone:current.timezone,task_id:task.id,task_version:task.version,success_criterion:"另一页面的标准",first_step:"另一页面的第一步"});
      }
      if(action==="snapshot"){res.end(JSON.stringify({focus:await f.ok("GET","today/focus"),tasks:(await f.ok("GET","today")).tasks,completed:(await f.ok("GET","today")).completed_tasks}));return;}
      res.end("{}");return;
    }
    if (!url.pathname.startsWith("/api/")) {
      vite.middlewares(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
      return;
    }
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (url.pathname === "/api/v1/auth/refresh") {
      res.end(
        JSON.stringify({
          code: "OK",
          message: "",
          requestId: "fixture",
          data: {
            accessToken: runtime.services.tokenService.issueAccessToken(
              owner.userId,
              "lighttick",
            ),
            user: { id: owner.userId, displayName: "笔记验收账号" },
          },
        }),
      );
      return;
    }
    if (fail && url.pathname === "/api/v1/lighttick/today/focus") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "Synthetic today-focus read failure",
          data: null,
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v[0] : v,
      ]),
    );
    const result = await runtime.app.handle({
      method: req.method!,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: raw ? JSON.parse(raw) : undefined,
    } as any);
    if(drop && req.method==="PUT" && url.pathname==="/api/v1/lighttick/today/focus" && result.statusCode<400){drop=false;res.statusCode=503;res.end(JSON.stringify({code:"FIXTURE_DROP",message:"选择响应中断",data:null}));return;}
    res.statusCode = result.statusCode;
    res.end(JSON.stringify(result.body));
  } catch (error) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        code: "FIXTURE_FAILURE",
        message: (error as Error).message,
        data: null,
      }),
    );
  }
});
server.listen(3194, "127.0.0.1", () =>
  console.log(
    "Today focus UI fixture ready http://127.0.0.1:3194/grow/today",
  ),
);
