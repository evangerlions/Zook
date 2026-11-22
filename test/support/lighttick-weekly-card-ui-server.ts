/** Synthetic local identity/faults; real Zook native actions, PostgreSQL and production static mount. */
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
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
import { WeeklyCardService } from "../../src/modules/lighttick/weekly-cards/weekly-card.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  root = process.env.LIGHTTICK_TEST_WEB_ROOT,
  port = Number(process.env.WEEKLY_UI_PORT ?? 3250);
if (
  !dsn ||
  !root ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_weekly_ui_")
)
  throw Error("Dedicated local weekly DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  o = { appId: "lighttick", userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...o,
  id: "weekly-browser-alice",
  status: "ACTIVE",
  accountRegion: "CN",
  joinedAt: new Date().toISOString(),
});
const delivery = seed.appConfigs.find(
    (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
  )!,
  config = JSON.parse(delivery.configValue);
config.settings = { ...config.settings, runtimeScope: "core" };
delivery.configValue = JSON.stringify(config);
await repo.deleteOwnerData(o);
const app = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
app.services.lighttickRuntime.nativeLearning.enabled = true;
const f = await seedTodayFocus(app),
  focus = new TodayFocusService(repo, app.services.lighttickRuntime.today),
  rhythm = new DailyRhythmService(repo),
  weekly = new WeeklyCardService(repo);
await app.services.lighttickRuntime.tasks.command(o, f.tasks[0].id, 1, {
  action: "complete",
  actualMinutes: 3,
  notes: "写出三个清楚的要点",
});
await focus.select(o, {
  request_key: "weekly-browser-select",
  base_version: 0,
  business_date: f.today.business_date,
  timezone: f.today.timezone,
  task_id: f.tasks[1].id,
  task_version: 1,
  success_criterion: "说明一个观点",
  first_step: "打开草稿",
});
for (const [index, step] of [
  "先写标题",
  "补一个要点",
  "核对一句表达",
].entries()) {
  let s = await focus.current(o);
  await rhythm.command(o, {
    request_key: "weekly-seed-mode-" + index,
    base_version: s.revision,
    business_date: s.business_date,
    timezone: s.timezone,
    task_id: s.task_id,
    task_version: s.task_version,
    action: "mode",
    mode: "minimum",
    minimum_step: step,
  });
  s = await focus.current(o);
  await rhythm.command(o, {
    request_key: "weekly-seed-attempt-" + index,
    base_version: s.revision,
    business_date: s.business_date,
    timezone: s.timezone,
    task_id: s.task_id,
    task_version: s.task_version,
    action: "attempt",
    confirmed: true,
  });
}
const tomorrow = new Date(Date.parse(f.today.business_date) + 86400000)
    .toISOString()
    .slice(0, 10),
  g = await f.ok("POST", "goals", {
    title: "后续目标",
    description: "",
    source_type: "user_input",
  }),
  plan = await f.ok("POST", "manual-plans", {
    goal_id: g.id,
    title: "后续关联计划",
    completion_criteria: "核对一条事实",
    period_start: f.today.business_date,
    period_end: tomorrow,
    tasks: [
      {
        id: randomUUID(),
        title: "明天先核对一条证据",
        scheduled_for: tomorrow,
        estimated_minutes: 5,
        completion_criteria: "核对一条事实",
        guidance: "打开记录",
      },
    ],
  });
await f.ok("POST", `manual-plans/${plan.id}/confirm`, {
  base_version: plan.version,
  goal_base_version: plan.goal_version,
});
let drop = false;
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: join(root, "dist"),
});
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith("/__weekly/")) {
      const action = u.pathname.split("/").at(-1);
      if (action === "drop-confirm") drop = true;
      if (action === "release") drop = false;
      if (action === "new-fact") {
        const s = await focus.current(o);
        await rhythm.command(o, {
          request_key: "fixture-later-attempt-" + s.revision,
          base_version: s.revision,
          business_date: s.business_date,
          timezone: s.timezone,
          task_id: s.task_id,
          task_version: s.task_version,
          action: "attempt",
          confirmed: true,
        });
      }
      if (action === "change-target") {
        const current = await repo.getGoal(o, g.id);
        await app.services.lighttickRuntime.goals.update(
          o,
          g.id,
          current!.version,
          { title: "后续目标（已核对）" },
        );
      }
      if (action === "pause-target") {
        const current = await repo.getGoal(o, g.id);
        await app.services.lighttickRuntime.goals.transition(
          o,
          g.id,
          current!.version,
          "pause",
          { reason: "验收中的暂停" },
        );
      }
      if (action === "stats") {
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            view: await weekly.read(o),
            tasks: (await repo.listTasks(o)).map((t) => ({
              id: t.id,
              title: t.title,
              status: t.status,
              version: t.version,
            })),
            receipts: (
              await pool.query(
                "SELECT action,count(*)::int AS n FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type='weekly-card' GROUP BY action",
                [o.appId, o.userId],
              )
            ).rows,
            event_counts: (
              await pool.query(
                "SELECT event_type,count(*)::int AS n FROM zook_lighttick_execution_events WHERE app_id=$1 AND user_id=$2 GROUP BY event_type",
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
            user: { id: o.userId, displayName: "合成周回看验收" },
          },
        }),
      );
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
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
      u.pathname.startsWith("/api/v1/lighttick/weekly-cards/")
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
  console.log(
    `Weekly fixture ready http://127.0.0.1:${port}/grow/weekly-cards`,
  ),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
