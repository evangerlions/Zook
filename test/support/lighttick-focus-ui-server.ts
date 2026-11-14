/** Synthetic identity/clock only; timer state, API, records and report aggregation use real Zook/PostgreSQL. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_focus_ui_")
)
  throw Error("Dedicated synthetic focus database and Web root required.");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true }),
  began = Date.now();
let advanceMs = 0;
const clock = () =>
  new Date(Date.parse("2026-11-14T10:00:00Z") + Date.now() - began + advanceMs);
seed.appUsers.push({
  ...owner,
  id: "focus-browser",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: clock().toISOString(),
});
const config = seed.appConfigs.find(
    (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
  )!,
  cfg = JSON.parse(config.configValue);
config.configValue = JSON.stringify({
  ...cfg,
  settings: { ...cfg.settings, runtimeScope: "core" },
});
const runtime = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: repo,
  }),
  lighttick = runtime.services.lighttickRuntime!;
lighttick.nativeLearning.enabled = true;
await repo.deleteOwnerData(owner);
const focus = new FocusService(repo, clock);
lighttick.focus = focus;
lighttick.accountReports = new AccountReportService(
  repo,
  lighttick.accountReports?.queue,
  () => lighttick.scopePolicy.assertFull(),
  clock,
);
for (let i = 0; i < 11; i++) {
  const started = await focus.start(owner, {
    request_key: "focus-history-start-" + i,
    kind: "focus",
    title: "历史专注 " + (i + 1),
    planned_seconds: 60,
  });
  advanceMs += 1000;
  await focus.command(owner, started.session!.id, {
    request_key: "focus-history-finish-" + i,
    base_version: 1,
    action: "finish",
    actual_seconds: 1,
    notes: "合成历史",
  });
}
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
let loseResponse = false,
  failRead = false,
  other = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3192");
  try {
    if (url.pathname.startsWith("/__focus/")) {
      res.setHeader("content-type", "application/json");
      const action = url.pathname.split("/").at(-1);
      if (action === "advance") {
        const seconds = Number(url.searchParams.get("seconds"));
        if (!Number.isFinite(seconds) || seconds < 0 || seconds > 7200)
          throw Error("Invalid synthetic clock step");
        advanceMs += seconds * 1000;
      }
      if (action === "lose-response") loseResponse = true;
      if (action === "fail-read") failRead = true;
      if (action === "recover") failRead = false;
      if (action === "other-start") {
        other++;
        await focus.start(owner, {
          request_key: "focus-other-start-" + other,
          kind: "focus",
          title: "另一端启动的专注",
          planned_seconds: 60,
        });
      }
      if (action === "snapshot") {
        const history = await repo.focus.history(owner, 0, 50),
          active = await repo.focus.active(owner);
        res.end(
          JSON.stringify({
            active: active
              ? {
                  id: active.id,
                  status: active.status,
                  revision: active.revision,
                  kind: active.kind,
                }
              : null,
            total: history.total,
            records: history.items.map((r) => ({
              id: r.id,
              kind: r.kind,
              status: r.status,
              actual_seconds: r.actual_seconds,
              notes: r.notes,
              business_date: r.business_date,
            })),
            summary: await repo.focus.summary(
              owner,
              "2026-11-14",
              "2026-11-14",
            ),
            tasks: (await repo.listTasks(owner)).length,
            readCompleted: (await repo.listReadingStates(owner)).filter(
              (r) => r.completedAt,
            ).length,
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
            user: { id: owner.userId, displayName: "专注休息验收" },
          },
        }),
      );
      return;
    }
    if (failRead && url.pathname === "/api/v1/lighttick/focus/current") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_FOCUS_READ",
          message: "计时状态暂时无法读取，请重试。",
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
      loseResponse &&
      req.method === "POST" &&
      url.pathname.includes("/focus/sessions/") &&
      result.statusCode === 200
    ) {
      loseResponse = false;
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_LOST_RESPONSE",
          message: "计时记录已保存，但响应中断；请核对原操作。",
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
server.listen(3192, "127.0.0.1", () =>
  console.log("Focus UI fixture ready http://127.0.0.1:3192/grow/focus"),
);
