/** Synthetic identity/failures; real Zook HTTP, owner storage and production static mount. */
import { createServer } from "node:http";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { seedCalendar } from "./calendar-fixture.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
import { CalendarService } from "../../src/modules/lighttick/calendar/calendar.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  root = process.env.LIGHTTICK_TEST_WEB_ROOT,
  port = Number(process.env.CALENDAR_UI_PORT ?? 3254);
if (
  !dsn ||
  !root ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_calendar_ui_")
)
  throw Error("Dedicated localhost calendar DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  o = { appId: "lighttick" as const, userId: "user_alice" };
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...o,
  id: "calendar-browser",
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
const f = await seedCalendar(app, repo, pool);
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
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: join(root, "dist"),
});
async function fingerprint() {
  const hashes: Record<string, string> = {};
  for (const table of [
    "tasks",
    "execution_events",
    "operations",
    "records",
    "record_versions",
    "native_lessons",
    "native_learning_private",
    "reading_states",
    "reading_workflow",
    "action_workspaces",
    "focus_sessions",
  ]) {
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
const before = await fingerprint();
let fail = false;
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith("/__calendar/")) {
      res.setHeader("content-type", "application/json");
      if (u.pathname.endsWith("/fail")) fail = true;
      if (u.pathname.endsWith("/recover")) fail = false;
      if (u.pathname.endsWith("/revoke") || u.pathname.endsWith("/grant")) {
        const a = (await repo.getLearningAuthority(o))!;
        await repo.saveLearningAuthority(
          {
            ...a,
            privateEnabled: u.pathname.endsWith("/grant"),
            revision: a.revision + 1,
          },
          a.revision,
        );
      }
      if (u.pathname.endsWith("/stats")) {
        const after = await fingerprint();
        res.end(
          JSON.stringify({
            before,
            after,
            unchanged: JSON.stringify(before) === JSON.stringify(after),
            view: await new CalendarService(repo).read(o, { month: f.month }),
            month: f.month,
            date: f.today.business_date,
          }),
        );
        return;
      }
      res.end(JSON.stringify({ month: f.month, date: f.today.business_date }));
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
            user: { id: o.userId, displayName: "合成活动日历验收" },
          },
        }),
      );
      return;
    }
    if (fail && u.pathname === "/api/v1/lighttick/calendar") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_UNAVAILABLE",
          message: "合成日历暂不可用",
          requestId: "fixture",
        }),
      );
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
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
    `Calendar fixture ready PID=${process.pid} http://127.0.0.1:${port}/grow/calendar`,
  ),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
