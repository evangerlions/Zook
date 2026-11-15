import { LightTickScopePolicy } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
/** Local synthetic errors acceptance server. No real accounts or model/GitHub requests. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_calibration_")
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
  settings: { ...value.settings, runtimeScope: "full" },
});
const runtime = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
await repo.deleteOwnerData(owner);
const forms = new FormRecordsService(repo);
let scope: "core" | "full" = "full";
runtime.services.lighttickRuntime!.scopePolicy = new LightTickScopePolicy(
  async () => ({
    ...config,
    configValue: JSON.stringify({
      ...value,
      settings: { ...value.settings, runtimeScope: scope },
    }),
  }),
);
const predictions = Array.from({ length: 60 }, (_, i) => ({
  date: "2026-11-" + String(1 + (i % 15)).padStart(2, "0"),
  statement: "合成预测 " + i,
  probability: i % 2 ? 80 : 100,
  result: i % 2 ? "correct" : "incorrect",
}));
await forms.save(
  owner,
  {
    base_revision: 0,
    data: {
      ...emptyFormRecords(),
      predictions: [
        ...predictions,
        {
          date: "2026-11-15",
          statement: "尚未结算",
          probability: 90,
          result: "pending",
        },
        {
          date: "2026-11-15",
          statement: "未知旧结果",
          probability: 90,
          result: "也许",
        },
        {
          date: "2026-11-15",
          statement: "空概率",
          probability: "",
          result: "incorrect",
        },
      ],
    },
  },
  "fixture-prediction-original",
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
let fail = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3197");
  try {
    if (url.pathname.startsWith("/__calibration/")) {
      res.setHeader("content-type", "application/json");
      const action = url.pathname.split("/").at(-1);
      if (action === "fail") fail = true;
      if (action === "recover") fail = false;

      if (action === "core") scope = "core";
      if (action === "full") scope = "full";
      if (action === "compete") {
        const current = await forms.read(owner);
        current.data.predictions[0] = {
          ...current.data.predictions[0],
          statement: "另一页面已修改预测",
        };
        await forms.save(
          owner,
          { base_revision: current.revision, data: current.data },
          "fixture-compete-" + Date.now(),
        );
      }
      if (action === "snapshot") {
        res.end(
          JSON.stringify({
            snapshot: await forms.read(owner),
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
            user: { id: owner.userId, displayName: "预测校准验收账号" },
          },
        }),
      );
      return;
    }
    if (
      fail &&
      req.method === "GET" &&
      url.pathname.startsWith(
        "/api/v1/lighttick/form-records/prediction-calibration",
      )
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
server.listen(3197, "127.0.0.1", () =>
  console.log(
    "Prediction calibration UI fixture ready http://127.0.0.1:3197/grow/prediction-calibration",
  ),
);
