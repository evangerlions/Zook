/** Synthetic localhost identity/faults; actual application, PostgreSQL and production static mount. */
import { createServer } from "node:http";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
import { seedTodayFocus } from "./today-focus-fixture.ts";
import { TodayFocusService } from "../../src/modules/lighttick/today-focus/today-focus.service.ts";
import { DailyRhythmService } from "../../src/modules/lighttick/today-focus/daily-rhythm.service.ts";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  root = process.env.LIGHTTICK_TEST_WEB_ROOT,
  port = Number(process.env.RHYTHM_UI_PORT ?? 3240);
if (
  !dsn ||
  !root ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_rhythm_ui_")
)
  throw Error("Dedicated local rhythm DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  o = { appId: "lighttick", userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...o,
  id: "rhythm-browser-alice",
  status: "ACTIVE",
  accountRegion: "CN",
  joinedAt: new Date().toISOString(),
});
const c = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const config = JSON.parse(c.configValue);
config.settings = { ...config.settings, runtimeScope: "core" };
c.configValue = JSON.stringify(config);
await repo.deleteOwnerData(o);
const app = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
app.services.lighttickRuntime.nativeLearning.enabled = true;
await seedTodayFocus(app);
const focus = new TodayFocusService(repo, app.services.lighttickRuntime.today),
  rhythm = new DailyRhythmService(repo),
  timers = new FocusService(repo);
let drop = "";
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: join(root, "dist"),
});
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith("/__rhythm/")) {
      const action = u.pathname.split("/").at(-1);
      if (action?.startsWith("drop-")) drop = action.slice(5);
      if (action === "release") drop = "";
      if (action === "external-mode") {
        const s = await focus.current(o);
        await rhythm.command(o, {
          request_key: "external-" + s.revision,
          base_version: s.revision,
          business_date: s.business_date,
          timezone: s.timezone,
          task_id: s.task_id,
          task_version: s.task_version,
          action: "mode",
          mode: "standard",
          minimum_step: "",
        });
      }
      if (action === "timer")
        await timers.start(o, {
          request_key: "fixture-focus-timer",
          kind: "focus",
          title: "验收中的计时",
          planned_seconds: 3600,
        });
      if (action === "stop-timer") {
        const t = await repo.focus.active(o);
        if (t)
          await timers.command(o, t.id, {
            request_key: "fixture-stop-timer",
            base_version: t.revision,
            action: "discard",
          });
      }
      if (action === "stats") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            focus: await focus.current(o),
            tasks: (await repo.listTasks(o)).map((t) => ({
              id: t.id,
              title: t.title,
              version: t.version,
              status: t.status,
              completedAt: t.completedAt ?? null,
              commitmentSatisfied: t.commitmentSatisfied ?? null,
            })),
            events: (await repo.listExecutionEvents(o)).map((e) => ({
              type: e.eventType,
              version: e.aggregateVersion,
              payload: e.payload,
            })),
            receipts: (
              await pool.query(
                "SELECT action,count(*)::int AS n FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type='today-rhythm' GROUP BY action",
                [o.appId, o.userId],
              )
            ).rows,
          }),
        );
        return;
      }
      res.end("ok");
      return;
    }
    if (staticHandler(req, res)) return;
    res.setHeader("content-type", "application/json");
    res.setHeader("cache-control", "no-store");
    if (u.pathname === "/api/v1/auth/refresh") {
      res.end(
        JSON.stringify({
          code: "OK",
          message: "",
          requestId: "fixture",
          data: {
            accessToken: app.services.tokenService.issueAccessToken(
              o.userId,
              "lighttick",
            ),
            user: { id: o.userId, displayName: "合成节奏验收" },
          },
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined,
      headers = Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v[0] : v,
        ]),
      );
    const response: any = await app.app.handle({
      method: req.method!,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers,
      body,
      ipAddress: "127.0.0.1",
    } as any);
    if (
      drop &&
      req.method === "PUT" &&
      u.pathname === "/api/v1/lighttick/today/focus/rhythm" &&
      body.action === drop
    ) {
      res.destroy();
      return;
    }
    res.statusCode = response.statusCode;
    for (const [k, v] of Object.entries(response.headers ?? {}))
      res.setHeader(k, v as any);
    res.end(JSON.stringify(response.body));
  } catch (e) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({ code: "FIXTURE_ERROR", message: (e as Error).message }),
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Rhythm fixture ready http://127.0.0.1:${port}/grow/today`),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
