import { ErrorRecordsService } from "../../src/modules/lighttick/error-records/error-records.service.ts";
/** Local synthetic errors acceptance server. No real accounts or model/GitHub requests. */
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
  !new URL(dsn).pathname.startsWith("/grow_web_u1_errors_")
)
  throw Error("Dedicated synthetic errors database and Web root required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool);
const owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...owner,
  id: "errors-browser",
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
const errors = new ErrorRecordsService(repo);
const today = new Date().toISOString().slice(0, 10);
const input = {
  base_version: 0,
  date: today,
  module_id: "general",
  category_id: "builtin-bias",
  description: "验收初始错误",
  severity: 3,
  context: "合成情境",
  improvement_action: "先核实再判断",
  is_repeat: false,
  related_error_id: null,
};
await errors.save(
  owner,
  "error-ui-anchor",
  { ...input, date: "2020-01-01", description: "历史关联锚点" },
  "fixture-anchor-001",
);
for (let n = 0; n < 23; n++)
  await errors.save(
    owner,
    "error-ui-" + String(n).padStart(2, "0"),
    {
      ...input,
      description: "验收初始错误 " + n,
      is_repeat: n % 2 === 0,
      related_error_id: "error-ui-anchor",
    },
    "fixture-row-" + String(n).padStart(3, "0"),
  );
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
let fail = false,
  drop = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3196");
  try {
    if (url.pathname.startsWith("/__errors/")) {
      res.setHeader("content-type", "application/json");
      const action = url.pathname.split("/").at(-1);
      if (action === "fail") fail = true;
      if (action === "recover") fail = false;
      if (action === "drop") drop = true;
      if (action === "compete") {
        const id = url.searchParams.get("id")!;
        const r = (await errors.detail(owner, id)).record;
        await errors.save(
          owner,
          id,
          {
            ...input,
            ...Object.fromEntries(
              Object.entries(r).filter(
                ([k]) =>
                  ![
                    "id",
                    "version",
                    "archived",
                    "created_at",
                    "updated_at",
                  ].includes(k),
              ),
            ),
            base_version: r.version,
            description: r.description + " · 其他页面更新",
          },
          "competing-" + Date.now(),
        );
      }
      if (action === "snapshot") {
        res.end(
          JSON.stringify({
            rows: (
              await pool.query(
                "SELECT data FROM zook_lighttick_error_records WHERE app_id=$1 AND user_id=$2 ORDER BY id",
                [owner.appId, owner.userId],
              )
            ).rows.map((r) => r.data),
            tasks: (
              await pool.query(
                "SELECT count(*)::int AS count FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2",
                [owner.appId, owner.userId],
              )
            ).rows,
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
    if (
      fail &&
      req.method === "GET" &&
      url.pathname.startsWith("/api/v1/lighttick/error-records")
    ) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "Synthetic errors read failure",
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
      drop &&
      req.method === "PUT" &&
      url.pathname.startsWith("/api/v1/lighttick/error-records/error-") &&
      result.statusCode < 400
    ) {
      drop = false;
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_DROP",
          message: "选择响应中断",
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
server.listen(3196, "127.0.0.1", () =>
  console.log("Today focus UI fixture ready http://127.0.0.1:3196/grow/errors"),
);
