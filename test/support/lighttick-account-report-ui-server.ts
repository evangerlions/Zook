/** Synthetic acceptance: real Zook report routes, PostgreSQL, queue and worker; fake identity/model only. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
import { AccountReportRunner } from "../../src/modules/lighttick/account-reports/account-report.runner.ts";
import { LightTickScopePolicy } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
import { LightTickRecordService } from "../../src/modules/lighttick/lighttick-record.service.ts";
import { emptyFormRecords } from "../../src/modules/lighttick/form-records/form-records.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_reports_ui_")
)
  throw Error("Dedicated synthetic reports database and Web root required.");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  queue = new InMemoryJobQueue(),
  owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true }),
  startedAt = Date.now(),
  clock = () =>
    new Date(Date.parse("2026-11-14T10:00:00Z") + Date.now() - startedAt);
seed.appUsers.push({
  ...owner,
  id: "reports-browser",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: clock().toISOString(),
});
const runtime = await createApplication({
    seed,
    queue,
    lighttickEnabled: true,
    lighttickRepository: repo,
  }),
  lighttick = runtime.services.lighttickRuntime!;
let full = true;
lighttick.scopePolicy = new LightTickScopePolicy(
  async () =>
    ({
      configValue: JSON.stringify({
        settings: { runtimeScope: full ? "full" : "core" },
      }),
    }) as any,
);
lighttick.nativeLearning.enabled = true;
await repo.deleteOwnerData(owner);
const records = new LightTickRecordService(repo, clock);
await records.mutate(
  owner,
  "report-browser-record-001",
  "save",
  {
    base_version: 0,
    raw_text: "SYNTHETIC_PRIVATE_RAW_DO_NOT_SEND",
    record_date: "2026-11-14",
  },
  "report-browser-record-save",
);
const forms = emptyFormRecords();
forms.modules = [
  { id: "growth", name: "成长练习", color: "#123456", order: 0 },
];
forms.checkins = { "2026-11-14": { growth: 1 } };
forms.habits = {
  "2026-11-14": { minutes: 25, note: "SYNTHETIC_PRIVATE_HABIT_DO_NOT_SEND" },
};
await repo.formRecords.save(
  owner,
  { revision: 1, data: forms, updated_at: clock().toISOString() },
  0,
);
const reports = new AccountReportService(
  repo,
  queue,
  () => lighttick.scopePolicy.assertFull(),
  clock,
);
lighttick.accountReports = reports;
let failNext = false,
  holdNext = false,
  llmCalls = 0,
  promptContainsPrivate = false;
const authorize = lighttick.worker!.accountReports!.authorizeOwner;
const runner = new AccountReportRunner(
  reports,
  {
    complete: async (request) => {
      llmCalls++;
      const prompt = JSON.stringify(request.messages);
      promptContainsPrivate ||= prompt.includes("SYNTHETIC_PRIVATE");
      const fail = failNext,
        hold = holdNext;
      failNext = false;
      holdNext = false;
      await new Promise((r) => setTimeout(r, hold ? 5000 : 150));
      if (fail) throw Error("SYNTHETIC_UPSTREAM_SECRET_NEVER_EXPOSE");
      return {
        text: JSON.stringify({
          overview: "本报告只描述本期已保存的记录，不代表全部实际活动。",
          observations: [
            {
              text: "请结合统计快照查看本期保存的随手记录。",
              evidence_keys: ["record"],
            },
          ],
          suggestions: ["选择一项小实验并补充可核对的结果。"],
          limitations: "单期统计不能判断趋势或原因；各时长来源不能相加。",
        }),
        finishReason: "stop",
        provider: "synthetic",
        providerModel: "report-browser-fixture",
      };
    },
  } as any,
  authorize,
);
Object.assign(lighttick.worker!, { accountReports: runner });
for (let i = 0; i < 11; i++)
  await reports.create(owner, {
    request_key: "report-history-" + String(i).padStart(3, "0"),
    period_days: i % 2 ? 7 : 30,
    mode: "facts",
  });
let ticking = false;
const tick = setInterval(() => {
  if (ticking) return;
  ticking = true;
  void queue
    .processDueJobs((job) => lighttick.worker!.process(job))
    .catch(() => {})
    .finally(() => {
      ticking = false;
    });
}, 100);
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
  failHistory = false,
  extra = 0;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3191");
  try {
    if (url.pathname.startsWith("/__reports/")) {
      res.setHeader("content-type", "application/json");
      const action = url.pathname.split("/").at(-1);
      if (action === "lose-response") loseResponse = true;
      if (action === "fail-next") failNext = true;
      if (action === "hold-next") holdNext = true;
      if (action === "core") full = false;
      if (action === "full") full = true;
      if (action === "fail-history") failHistory = true;
      if (action === "recover") failHistory = false;
      if (action === "add-record") {
        extra++;
        await records.mutate(
          owner,
          "report-browser-extra-" + String(extra).padStart(3, "0"),
          "save",
          {
            base_version: 0,
            raw_text: "SYNTHETIC_PRIVATE_EXTRA",
            record_date: "2026-11-14",
          },
          "report-browser-extra-save-" + extra,
        );
      }
      if (action === "snapshot") {
        const all = await repo.accountReports.list(owner, 0, 50);
        const detailed = await Promise.all(
          all.items.map((item) => repo.accountReports.get(owner, item.id)),
        );
        res.end(
          JSON.stringify({
            total: all.total,
            reports: detailed
              .filter((r) => !!r)
              .map((r) => ({
                id: r.id,
                status: r.status,
                revision: r.revision,
                digest: r.facts?.digest,
                records: r.facts?.metrics.find((m) => m.key === "record")
                  ?.count,
              })),
            llmCalls,
            promptContainsPrivate,
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
            user: { id: owner.userId, displayName: "全账户报告验收" },
          },
        }),
      );
      return;
    }
    if (
      failHistory &&
      url.pathname === "/api/v1/lighttick/account-reports" &&
      req.method === "GET"
    ) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_REPORT_HISTORY",
          message: "报告历史暂时无法读取，请重试。",
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
      url.pathname === "/api/v1/lighttick/account-reports" &&
      req.method === "POST"
    ) {
      loseResponse = false;
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_LOST_RESPONSE",
          message: "报告已保存，但响应中断；请核对原请求。",
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
server.listen(3191, "127.0.0.1", () =>
  console.log(
    "Account report UI fixture ready http://127.0.0.1:3191/grow/growth/account-reports",
  ),
);
server.on("close", () => clearInterval(tick));
