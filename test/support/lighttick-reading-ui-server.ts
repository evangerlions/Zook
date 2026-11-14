/** Synthetic local reading acceptance server: real Zook routes/PostgreSQL; only external feed boundary is deterministic. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { ReadingWorkflowService } from "../../src/modules/lighttick/reading/reading-workflow.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_reading_ui_")
)
  throw Error("Dedicated synthetic reading database and Web root required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  owner = { appId: "lighttick", userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...owner,
  id: "reading-browser",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: new Date().toISOString(),
});
const config = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const cfg = JSON.parse(config.configValue);
config.configValue = JSON.stringify({
  ...cfg,
  settings: { ...cfg.settings, runtimeScope: "core" },
});
const runtime = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
runtime.services.lighttickRuntime!.nativeLearning.enabled = true;
await repo.deleteOwnerData(owner);
let fetchCalls = 0;
const workflow = new ReadingWorkflowService(repo, async (url) => {
  fetchCalls++;
  if (url.includes("unavailable"))
    throw Error("synthetic upstream error never exposed");
  return "<rss><channel><item><title>阅读发现验证文章</title><link>https://example.com/reading-discovery?utm_source=feed</link><description>&lt;p&gt;这是一段订阅摘要，保存后安排到今日。&lt;/p&gt;</description></item><item><title>重复文章</title><link>https://example.com/reading-discovery</link></item><item><title>另一篇阅读候选</title><link>https://example.com/reading-second</link><description>用于筛选与第二篇安排。</description></item></channel></rss>";
});
runtime.services.lighttickRuntime!.readingWorkflow = workflow;
await workflow.addSource(owner, {
  name: "验收订阅",
  url: "https://example.com/reading-feed",
  language: "zh",
  topics: ["成长"],
});
await workflow.addSource(owner, {
  name: "失败订阅",
  url: "https://example.com/unavailable",
  language: "en",
  topics: ["认知"],
});
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
let lostResponse = false,
  taskFailure = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3190");
  try {
    if (url.pathname.startsWith("/__reading/")) {
      res.setHeader("content-type", "application/json");
      if (url.pathname.endsWith("/lose-response")) lostResponse = true;
      if (url.pathname.endsWith("/fail-tasks")) taskFailure = true;
      if (url.pathname.endsWith("/recover")) taskFailure = false;
      if (url.pathname.endsWith("/snapshot")) {
        const tasks = await repo.listReadingEntries(owner, "task"),
          collections = await repo.listReadingEntries(owner, "collection");
        res.end(
          JSON.stringify({
            tasks,
            collections: collections.length,
            fetchCalls,
            states: await repo.listReadingStates(owner),
          }),
        );
        return;
      }
      res.end("{}");
      return;
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
    if (taskFailure && url.pathname === "/api/v1/lighttick/reading/tasks") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "阅读任务暂时无法读取，请重试。",
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
    if (
      lostResponse &&
      req.method === "POST" &&
      url.pathname === "/api/v1/lighttick/reading/collections"
    ) {
      lostResponse = false;
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_LOST_RESPONSE",
          message: "搜集结果已保存，但响应中断；请重试原搜集。",
          data: null,
        }),
      );
      return;
    }
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
server.listen(3190, "127.0.0.1", () =>
  console.log("Reading UI fixture ready http://127.0.0.1:3190/grow/reading"),
);
