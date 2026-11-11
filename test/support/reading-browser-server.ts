import { ReadingWorkRunner } from "../../src/modules/lighttick/reading/reading-work.runner.ts";
/** Loopback-only synthetic acceptance fixture, never a deployable backend.
 * Real LightTick route handlers and dedicated PG repository; ephemeral synthetic
 * membership/session bootstrap avoids collecting any user's login credentials.
 */
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { createServer } from "node:http";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createGrowStaticHandler } from "../../apps/admin-web/grow-static.ts";
const url = process.env.LIGHTTICK_READING_TEST_DATABASE_URL;
if (
  !url ||
  !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
  !/^(?:lighttick_full_migration_[0-9]+|grow_web_u1_content_completion_[0-9]+)$/.test(
    new URL(url).pathname.slice(1),
  )
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
runtime.services.lighttickRuntime!.nativeLearning = new NativeLearningService(
  repository,
  true,
);
const staticHandler = createGrowStaticHandler({
  growEnabled: true,
  growRoot: root,
});
const syntheticProviders = process.argv.includes(
  "--synthetic-reading-providers",
);
const syntheticRunner = new ReadingWorkRunner(
  runtime.services.lighttickRuntime!.readingWork!,
  {
    complete: async () => ({
      text: "合成模型验收输出：这是用于核对任务、草稿与显式采用的替身结果，不是真实模型验证。",
      provider: "synthetic-acceptance",
      providerModel: "fixture",
    }),
  } as any,
  async (url) => {
    if (new URL(url).hostname !== "reading.example.test")
      throw Error(
        "Only the disclosed synthetic provider is available in this fixture",
      );
    return url.includes("feed")
      ? {
          body: "<rss><channel><language>en</language><item><title>Synthetic feed article</title><link>https://reading.example.test/article</link><description><![CDATA[<p>Original synthetic feed excerpt.</p>]]></description><author>Synthetic author</author></item></channel></rss>",
          content_type: "application/rss+xml",
        }
      : {
          body: "<article><p>Original synthetic paragraph one.</p><p>Original synthetic paragraph two.</p></article>",
          content_type: "text/html",
        };
  },
  async () => runtime.services.lighttickRuntime!.scopePolicy.assertFull(),
);
let dropNext: string | null = null;
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
    if (u.pathname.startsWith("/__synthetic/")) {
      if (
        req.method !== "POST" ||
        req.headers["x-lighttick-acceptance"] !== "local-synthetic"
      ) {
        send(403, { code: "SYNTHETIC_CONTROL_DENIED" });
        return;
      }
      const body = raw ? JSON.parse(raw) : {};
      if (
        u.pathname === "/__synthetic/scope" &&
        ["core", "full"].includes(body.scope)
      ) {
        await runtime.services.appConfigService.setValue(
          "lighttick",
          "admin.delivery_config",
          JSON.stringify({
            enabled: true,
            settings: { runtimeScope: body.scope },
          }),
        );
        send(200, { scope: body.scope });
        return;
      }
      if (
        u.pathname === "/__synthetic/drop-next" &&
        typeof body.path === "string" &&
        /^\/api\/v1\/lighttick\/(?:reading\/(?:work|sources)(?:\/|$)|learning\/modules\/)/.test(
          body.path,
        )
      ) {
        dropNext = body.path;
        send(200, { armed: true });
        return;
      }
      if (u.pathname === "/__synthetic/run-reading" && syntheticProviders) {
        const rows = await repository.readingWork.recoverable(
          new Date().toISOString(),
          100,
        );
        for (const row of rows)
          if (row.userId === "user_alice" && row.status === "queued")
            await syntheticRunner.execute(row, row.id);
        send(200, {
          processed: rows.filter((r) => r.userId === "user_alice").length,
          provider_validation: "synthetic_only",
        });
        return;
      }
      send(404, { code: "UNKNOWN_SYNTHETIC_CONTROL" });
      return;
    }
    const result = await runtime.app.handle({
      method: req.method ?? "GET",
      path: u.pathname,
      query: Object.fromEntries(u.searchParams),
      body: raw ? JSON.parse(raw) : undefined,
      headers,
    });
    if (
      dropNext === u.pathname &&
      result.statusCode === 200 &&
      !["GET", "HEAD"].includes(req.method ?? "")
    ) {
      dropNext = null;
      send(503, {
        code: "SYNTHETIC_RESPONSE_LOST",
        message: "Committed result intentionally hidden by synthetic fixture",
        data: null,
      });
      return;
    }
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
server.listen(58743, "127.0.0.1", () =>
  console.log(
    "Synthetic reading acceptance: http://127.0.0.1:58743/grow/reading",
  ),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () =>
    server.close(async () => {
      await pool.end();
      process.exit(0);
    }),
  );
