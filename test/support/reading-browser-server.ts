/** Loopback-only synthetic acceptance fixture, never a deployable backend.
 * Real LightTick route handlers and dedicated PG repository; ephemeral synthetic
 * membership/session bootstrap avoids collecting any user's login credentials.
 */
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
const url = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !url ||
  !/^lighttick_full_migration_[0-9]+$/.test(new URL(url).pathname.slice(1))
)
  throw Error("Dedicated synthetic database required.");
const root = process.argv[process.argv.indexOf("--artifact") + 1];
if (!process.argv.includes("--artifact") || !root)
  throw Error("--artifact is required");
const pool = new Pool({ connectionString: url });
const repository = new PostgresLightTickRepository(pool);
const seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  id: "reading-browser-member",
  appId: "lighttick",
  userId: "user_alice",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: new Date().toISOString(),
});
const runtime = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repository,
});
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: root,
});
const server = createServer(async (req, res) => {
  const send = (status: number, body: unknown) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(body));
  };
  try {
    if (staticHandler(req, res)) return;
    const u = new URL(req.url ?? "/", "http://127.0.0.1");
    if (u.pathname === "/api/v1/auth/refresh" && req.method === "POST") {
      send(200, {
        code: "OK",
        message: "synthetic session",
        requestId: "reading-browser-fixture",
        data: {
          accessToken: runtime.services.tokenService.issueAccessToken(
            "user_alice",
            "lighttick",
          ),
          user: { id: "user_alice", displayName: "阅读验收（合成）" },
        },
      });
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        send(413, { code: "TOO_LARGE" });
        return;
      }
      chunks.push(Buffer.from(chunk));
    }
    const raw = Buffer.concat(chunks).toString();
    const headers = Object.fromEntries(
      Object.entries(req.headers).map(([k, v]) => [
        k,
        Array.isArray(v) ? v[0] : v,
      ]),
    );
    const result = await runtime.app.handle({
      method: req.method ?? "GET",
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      body: raw ? JSON.parse(raw) : undefined,
      headers,
    });
    res.writeHead(result.statusCode, {
      "Content-Type": result.contentType ?? "application/json",
      ...result.headers,
    });
    res.end(JSON.stringify(result.body));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "fixture error");
    send(500, { code: "SYNTHETIC_FIXTURE_ERROR" });
  }
});
server.listen(58742, "127.0.0.1", () =>
  console.log(
    "Synthetic reading acceptance: http://127.0.0.1:58742/grow/reading",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
