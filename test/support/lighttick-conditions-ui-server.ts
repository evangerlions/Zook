/** Synthetic identity and injected faults; actual Zook HTTP/PG and production static handler. */
import { createServer } from "node:http";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { seedTodayFocus } from "./today-focus-fixture.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
import { GoalConditionsService } from "../../src/modules/lighttick/goal-context/goal-conditions.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  root = process.env.LIGHTTICK_TEST_WEB_ROOT,
  port = Number(process.env.CONDITIONS_UI_PORT ?? 3260);
if (
  !dsn ||
  !root ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_conditions_ui_")
)
  throw Error("Dedicated localhost conditions database required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  o = { appId: "lighttick" as const, userId: "user_alice" };
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...o,
  id: "conditions-browser",
  status: "ACTIVE",
  accountRegion: "CN",
  joinedAt: new Date().toISOString(),
});
const app = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
await repo.deleteOwnerData(o);
const f = await seedTodayFocus(app),
  goalId = f.tasks[0].goal_id,
  date = f.today.business_date,
  service = new GoalConditionsService(repo);
const tomorrow = new Date(Date.parse(date) + 86400000)
  .toISOString()
  .slice(0, 10);
for (const c of [
  {
    id: "older-ongoing",
    scope: "ongoing",
    daily_minutes: 60,
    reason: "较早持续条件",
  },
  {
    id: "ongoing-budget",
    scope: "ongoing",
    daily_minutes: 40,
    reason: "当前持续条件",
  },
  {
    id: "temporary-budget",
    scope: "temporary",
    daily_minutes: 20,
    reason: "临时出差窗口",
  },
]) {
  const goal = (await repo.getGoal(o, goalId))!;
  await service.confirm(o, goalId, randomUUID(), {
    ...c,
    base_version: goal.version,
    condition_version: 0,
    starts_on: date,
    ends_on: c.scope === "temporary" ? tomorrow : null,
    active: true,
  });
}
const config = JSON.parse(
  (await app.services.appConfigService.getValue(
    "lighttick",
    "admin.delivery_config",
  ))!,
);
config.settings.runtimeScope = "core";
await app.services.appConfigService.setValue(
  "lighttick",
  "admin.delivery_config",
  JSON.stringify(config),
);
async function fingerprint() {
  const hashes: Record<string, string> = {};
  for (const table of ["tasks", "plans", "task_steps"]) {
    const r = await pool.query(
      `SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text),'[]'::jsonb) AS rows FROM zook_lighttick_${table} t WHERE app_id=$1 AND user_id=$2`,
      [o.appId, o.userId],
    );
    hashes[table] = createHash("sha256")
      .update(JSON.stringify(r.rows[0].rows))
      .digest("hex");
  }
  return hashes;
}
const before = await fingerprint(),
  meta = {
    goal_id: goalId,
    date,
    temporary_id: "temporary-budget",
    ongoing_id: "ongoing-budget",
  };
let drop = false;
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: join(root, "dist"),
});
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith("/__conditions/")) {
      res.setHeader("content-type", "application/json");
      if (u.pathname.endsWith("/drop")) drop = true;
      if (u.pathname.endsWith("/release")) drop = false;
      if (u.pathname.endsWith("/change")) {
        const c = await service.context(o, goalId, date, date),
          previous = c.conditions
            .filter((c) => c.id === "temporary-budget")
            .at(-1)!;
        await service.confirm(o, goalId, randomUUID(), {
          id: previous.id,
          condition_version: previous.revision,
          base_version: c.goal.version,
          scope: previous.scope,
          starts_on: previous.starts_on,
          ends_on: previous.ends_on,
          daily_minutes: 18,
          active: true,
          reason: "另一端已调整为18分钟",
        });
      }
      if (u.pathname.endsWith("/archive")) {
        const g = (await repo.getGoal(o, goalId))!;
        await app.services.lighttickRuntime.goals.transition(
          o,
          goalId,
          g.version,
          "archive",
          { reason: "合成只读验证" },
        );
      }
      if (u.pathname.endsWith("/stats")) {
        const after = await fingerprint();
        res.end(
          JSON.stringify({
            before,
            after,
            work_unchanged: JSON.stringify(before) === JSON.stringify(after),
            context: await service.context(o, goalId, date, date),
            receipts: (
              await pool.query(
                "SELECT count(*)::int AS n FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND action=$3",
                [o.appId, o.userId, "goal-condition:" + goalId],
              )
            ).rows[0].n,
          }),
        );
        return;
      }
      res.end(JSON.stringify(meta));
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
            user: { id: o.userId, displayName: "合成条件管理验收" },
          },
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const response: any = await app.app.handle({
      method: req.method!,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([k, v]) => [
          k,
          Array.isArray(v) ? v[0] : v,
        ]),
      ),
      body: raw ? JSON.parse(raw) : undefined,
      ipAddress: "127.0.0.1",
    } as any);
    if (
      drop &&
      req.method === "POST" &&
      u.pathname.endsWith("/conditions") &&
      response.statusCode === 200
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
    `Conditions fixture ready PID=${process.pid} http://127.0.0.1:${port}/grow/growth/goals?focus=${goalId}&date=${date}`,
  ),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
