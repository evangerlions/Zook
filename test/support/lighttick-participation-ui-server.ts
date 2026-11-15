/** Synthetic local identities, email delivery and clock; actual Common Auth, LightTick HTTP/PG and static mount. */
import { createServer } from "node:http";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ParticipationService } from "../../src/modules/lighttick/participation/participation.service.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  root = process.env.LIGHTTICK_TEST_WEB_ROOT,
  port = Number(process.env.PARTICIPATION_UI_PORT ?? 3230);
if (
  !dsn ||
  !root ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_participation_ui_")
)
  throw Error("Dedicated local participation DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  alice = { appId: "lighttick", userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
for (const row of (
  await pool.query(
    "SELECT DISTINCT user_id FROM zook_lighttick_operations WHERE app_id='lighttick' AND entity_type='participation'",
  )
).rows)
  await repo.deleteOwnerData({ appId: "lighttick", userId: row.user_id });
await repo.deleteOwnerData(alice);
seed.appUsers.push({
  ...alice,
  id: "participation-browser-alice",
  status: "ACTIVE",
  accountRegion: "CN",
  joinedAt: new Date(Date.now() - 86400000).toISOString(),
});
const app = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
  registrationCodeGenerator: () => "246813",
  registrationEmailSender: {
    async sendTemplateEmail() {
      return { provider: "tencent_ses" };
    },
    async sendVerificationCode() {
      return { provider: "tencent_ses" };
    },
  },
});
let offset = 0,
  autoAlice = true,
  drop = "",
  registeredId = "";
const s = new ParticipationService(
  repo,
  ["participation-browser-test-secret"],
  async (id) => {
    const u = await app.database.findUserById(id),
      m = await app.database.findAppUser("lighttick", id);
    return {
      active: u?.status === "ACTIVE" && m?.status === "ACTIVE",
      joinedAt: m?.joinedAt ?? "",
      test: false,
    };
  },
  () => new Date(Date.now() + offset),
);
app.services.lighttickRuntime.participation = s;
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: join(root, "dist"),
});
const server = createServer(async (req, res) => {
  try {
    const u = new URL(req.url!, `http://127.0.0.1:${port}`);
    if (u.pathname.startsWith("/__participation/")) {
      const action = u.pathname.split("/").at(-1);
      if (action === "common") autoAlice = false;
      if (action === "alice") autoAlice = true;
      if (action?.startsWith("drop-")) drop = action.slice(5);
      if (action === "release") drop = "";
      if (action === "day7") offset = 6 * 86400000;
      if (action === "day14") offset = 13 * 86400000;
      if (action === "day15") offset = 14 * 86400000;
      if (action === "external-survey") {
        const o = { appId: "lighttick", userId: registeredId },
          t = await repo.participation.trial(o);
        await s.command(o, "external-survey-" + t!.version, "survey", {
          day: 7,
          version: t!.version,
          clarity_score: 1,
          progress_score: 1,
        });
      }
      if (action === "core") {
        const c = JSON.parse(
          (await app.services.appConfigService.getValue(
            "lighttick",
            "admin.delivery_config",
          ))!,
        );
        c.settings.runtimeScope = "core";
        await app.services.appConfigService.setValue(
          "lighttick",
          "admin.delivery_config",
          JSON.stringify(c),
        );
      }
      if (action === "stats") {
        const o = { appId: "lighttick", userId: registeredId || alice.userId };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            state: await s.read(o),
            inviter: await s.read(alice),
            subscription: (await repo.getUserSubscription(o)) ?? null,
            receipts: (
              await pool.query(
                "SELECT action,count(*)::int AS n FROM zook_lighttick_operations WHERE app_id=$1 AND entity_type='participation' GROUP BY action",
                ["lighttick"],
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
    if (autoAlice && u.pathname === "/api/v1/auth/refresh") {
      res.end(
        JSON.stringify({
          code: "OK",
          message: "",
          requestId: "fixture",
          data: {
            accessToken: app.services.tokenService.issueAccessToken(
              alice.userId,
              "lighttick",
            ),
            user: { id: alice.userId, displayName: "合成邀请人" },
          },
        }),
      );
      return;
    }
    let raw = "";
    for await (const c of req) raw += c;
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v[0] : v,
      ]),
    );
    const r: any = await app.app.handle({
      method: req.method!,
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      headers,
      body: raw ? JSON.parse(raw) : undefined,
      ipAddress: "127.0.0.1",
    } as any);
    if (u.pathname === "/api/v1/auth/register" && r.statusCode === 200)
      registeredId = r.body.data.user.id;
    if (
      drop &&
      req.method === "POST" &&
      u.pathname === "/api/v1/lighttick/participation/" + drop
    ) {
      res.destroy();
      return;
    }
    res.statusCode = r.statusCode;
    for (const [key, val] of Object.entries(r.headers ?? {}))
      res.setHeader(key, val as any);
    res.end(JSON.stringify(r.body));
  } catch (e) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({ code: "FIXTURE_ERROR", message: (e as Error).message }),
    );
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(
    `Participation fixture ready http://127.0.0.1:${port}/grow/participation`,
  ),
);
async function stop() {
  server.close();
  await pool.end();
  process.exit();
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
