// Loopback-only synthetic native UI acceptance. Never imported by runtime entry points.
import http from "node:http";
import { Pool } from "pg";
import { createApplication } from "../test/support/create-test-application.ts";
import { buildDefaultSeed } from "../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../src/infrastructure/database/postgres/migrate.ts";
const databaseUrl = process.env.LIGHTTICK_TEST_DATABASE_URL ?? "";
const url = new URL(databaseUrl);
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "55441" ||
  url.pathname !== "/native_cloud_loop_qa"
)
  throw Error(
    "This fixture requires its disposable loopback native_cloud_loop_qa database on port 55441.",
  );
await runPostgresMigrations({ connectionString: databaseUrl, log: () => {} });
const pool = new Pool({ connectionString: databaseUrl, max: 6 }),
  repository = new PostgresLightTickRepository(pool);
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
for (const id of ["user_alice", "user_bob"])
  seed.appUsers.push({
    id: `manual-ui-${id}`,
    appId: "lighttick",
    userId: id,
    status: "ACTIVE",
    accountRegion: "UNKNOWN",
    joinedAt: new Date().toISOString(),
  });
const delivery = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const configuration = JSON.parse(delivery.configValue);
configuration.enabled = true;
// Accept both current native debug baselines; this does not change production configuration.
configuration.minimumClientVersions = { ios: "0.1.0", android: "0.1.0" };
configuration.featureFlags = {};
delivery.configValue = JSON.stringify(configuration);
const app = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repository,
});
app.services.lighttickRuntime.planningEnabled = false;
const owner = { appId: "lighttick" as const, userId: "user_alice" };
let offline = false,
  dropNext = "",
  nativePhase = "";
const requests: { method: string; path: string; status: number }[] = [];
const server = http.createServer(async (req, res) => {
  try {
    const target = new URL(req.url ?? "/", "http://127.0.0.1:3107");
    if (target.pathname === "/__phase") {
      if (target.searchParams.has("value"))
        nativePhase = target.searchParams.get("value") ?? "";
      res.end(JSON.stringify({ phase: nativePhase }));
      return;
    }
    if (target.pathname === "/__reset") {
      await repository.deleteOwnerData(owner);
      offline = false;
      dropNext = "";
      requests.length = 0;
      res.end("{}");
      return;
    }
    if (target.pathname === "/__offline") {
      offline = target.searchParams.get("value") === "1";
      res.end("{}");
      return;
    }
    if (target.pathname === "/__drop-next") {
      dropNext = target.searchParams.get("kind") ?? "confirm";
      res.end("{}");
      return;
    }
    if (target.pathname === "/__state") {
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          plans: (await repository.listPlans(owner)).map((p) => ({
            id: p.id,
            status: p.status,
            version: p.version,
            goal_id: p.goalId,
          })),
          tasks: (await repository.listTasks(owner)).map((t) => ({
            id: t.id,
            plan_id: t.planId,
            title: t.title,
            status: t.status,
            estimate: t.estimatedMinutes,
            date: t.scheduledFor ?? null,
          })),
          requests,
        }),
      );
      return;
    }
    if (
      (!target.pathname.startsWith("/api/v1/lighttick/") &&
        !target.pathname.startsWith("/api/v1/auth/")) ||
      /\/(coach-runs|planning-sessions|action-plans|learning-library)/.test(
        target.pathname,
      )
    ) {
      requests.push({
        method: req.method ?? "",
        path: target.pathname,
        status: 501,
      });
      res.writeHead(501);
      res.end("{}");
      return;
    }
    if (offline) {
      requests.push({
        method: req.method ?? "",
        path: target.pathname,
        status: 503,
      });
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "Synthetic network failure",
        }),
      );
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const response = await app.app.handle({
      method: req.method as any,
      path: target.pathname,
      query: Object.fromEntries(target.searchParams),
      headers: { ...req.headers } as any,
      body: raw ? JSON.parse(raw) : undefined,
    });
    requests.push({
      method: req.method ?? "",
      path: target.pathname,
      status: response.statusCode,
    });
    if (
      response.statusCode < 300 &&
      dropNext &&
      (target.pathname.endsWith("/" + dropNext) ||
        (dropNext === "adopt" && target.pathname.endsWith("/local-adoptions")))
    ) {
      dropNext = "";
      offline = true;
      res.destroy();
      return;
    }
    res.writeHead(response.statusCode, {
      ...response.headers,
      "Content-Type": "application/json",
    });
    res.end(JSON.stringify(response.body));
  } catch (error) {
    res.writeHead(500, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        code: "SYNTHETIC_SERVER_FAILURE",
        message: String(error),
      }),
    );
  }
});
server.listen(3107, "127.0.0.1", () =>
  process.stdout.write(
    "Native manual acceptance: loopback 3107; real isolated PostgreSQL; Grow/AI routes blocked.\n",
  ),
);
process.on("SIGTERM", () =>
  server.close(() => {
    void pool.end().then(() => process.exit(0));
  }),
);
