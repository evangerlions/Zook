import { LightTickScopePolicy } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
/** Real Zook/PG/learning queue worker, synthetic identity and model boundary only. */
import { createServer } from "node:http";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_course_review_")
)
  throw Error("Dedicated synthetic course DB required");
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool),
  queue = new InMemoryJobQueue(),
  owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...owner,
  id: "course-ui",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: new Date().toISOString(),
});
const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: repo,
    queue,
  } as any),
  runtime = app.services.lighttickRuntime!;
await repo.deleteOwnerData(owner);
const native = new NativeLearningService(repo, true),
  work = new LearningWorkService(new LearningRouteService(native), queue);
runtime.nativeLearning = native;
runtime.learningWork = work;
await native.saveCollection(
  owner,
  "review-ui-course",
  { base_revision: 0, title: "结构化思考课程", archived: false },
  "ui-course-create",
);
for (let i = 1; i <= 3; i++) {
  const id = "lesson-review-ui-" + i,
    lesson = await native.publish(
      owner,
      id,
      {
        base_revision: 0,
        collection_id: "review-ui-course",
        number: i,
        title: ["拆解问题", "检验假设", "实践迁移"][i - 1],
        content: "# MODEL_MUST_NOT_SEE_BODY",
        references: "",
      },
      "ui-publish-" + i,
    );
  await native.privateCommand(
    owner,
    id,
    {
      action: "save",
      content_version: lesson.content_version,
      base_revision: 0,
      notes: "MODEL_MUST_NOT_SEE_NOTES",
      answers: [],
    },
    "ui-note-" + i,
  );
  if (i <= 2)
    await native.privateCommand(
      owner,
      id,
      {
        action: "complete",
        content_version: lesson.content_version,
        base_revision: 0,
      },
      "ui-complete-" + i,
    );
}
let delay = 100,
  failModel = false,
  failRead = false,
  drop = false,
  scope: "full" | "core" = "full",
  calls = 0,
  leaked = false;
const config = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const cfg = JSON.parse(config.configValue);
runtime.scopePolicy = new LightTickScopePolicy(async () => ({
  ...config,
  configValue: JSON.stringify({
    ...cfg,
    settings: { ...cfg.settings, runtimeScope: scope },
  }),
}));
const runner = new LearningWorkRunner(
  work,
  {
    complete: async (request: any) => {
      calls++;
      const raw = JSON.stringify(request.messages);
      if (raw.includes("MODEL_MUST_NOT_SEE")) leaked = true;
      await new Promise((r) => setTimeout(r, delay));
      if (failModel) throw Error("Synthetic provider failure");
      if (raw.includes("LIGHTTICK_COURSE_REVIEW_V1"))
        return {
          text: JSON.stringify({
            overview:
              "依据已完成课名整理：拆解问题与检验假设。未读取课程正文。",
            self_assessment: "理解情况来自本人自评，仍需实践验证。",
            connections: "两类主题的联系待核实。",
            next_directions: ["用工作案例检验假设"],
            limitations: "仅覆盖已明确完成的课次；没有练习评分或实际效果证据。",
          }),
          provider: "fixture",
          providerModel: "fixture-model",
          finishReason: "stop",
        };
      const payload = JSON.parse(
          request.messages[1].content.split("INPUT_JSON=")[1],
        ),
        b = payload.brief,
        n = b.lesson_count ?? b.weeks * b.sessions;
      return {
        text: JSON.stringify({
          prerequisites: "按本人当前基础逐步练习，不推断掌握。",
          stages: [{ title: "案例练习", goal: b.goal }],
          lessons: Array.from({ length: n }, (_, i) => ({
            number: i + 1,
            topic: i === n - 1 ? "回顾实践证据" : "案例练习 " + (i + 1),
            goal: b.goal,
            exercise: "用真实案例检验",
            assessment: "保留过程证据",
            minutes: Math.min(20, b.minutes),
            stage: 1,
            kind: i === n - 1 ? "review" : "lesson",
            requires: i ? [i] : [],
          })),
        }),
        provider: "fixture",
        providerModel: "fixture-model",
        finishReason: "stop",
      };
    },
  } as any,
  {} as any,
  async () => runtime.scopePolicy.assertFull(),
);
Object.assign(runtime.worker!, { learning: runner });
let pumping = false;
setInterval(() => {
  if (pumping) return;
  pumping = true;
  void queue
    .processDueJobs((job) => runtime.worker!.process(job))
    .catch(() => {})
    .finally(() => {
      pumping = false;
    });
}, 60).unref();
const { createServer: createVite } = await import(
    pathToFileURL(join(webRoot, "node_modules/vite/dist/node/index.js")).href
  ),
  vite = await createVite({
    configFile: false,
    root: webRoot,
    base: "/grow/",
    server: { middlewareMode: true },
    appType: "spa",
  });
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3195");
  try {
    if (url.pathname.startsWith("/__course-review/")) {
      const action = url.pathname.split("/").at(-1);
      res.setHeader("content-type", "application/json");
      if (action === "drop") drop = true;
      if (action === "fail-read") failRead = true;
      if (action === "recover") {
        failRead = false;
        failModel = false;
        delay = 100;
      }
      if (action === "slow") delay = 4500;
      if (action === "fail-model") failModel = true;
      if (action === "core") scope = "core";
      if (action === "full") scope = "full";
      if (action === "revoke" || action === "grant") {
        const a = (await repo.getLearningAuthority(owner))!;
        await repo.saveLearningAuthority(
          {
            ...a,
            privateEnabled: action === "grant",
            revision: a.revision + 1,
          },
          a.revision,
        );
      }
      if (action === "snapshot") {
        const history = await work.store.courseSummaries(
          owner,
          "review-ui-course",
          "",
          100,
        );
        res.end(
          JSON.stringify({
            calls,
            leaked,
            history: history.map((w) => ({
              id: w.id,
              status: w.status,
              output: w.output,
              facts: w.input.course_review,
            })),
            feedback: await repo.courseReview.list(owner, "review-ui-course"),
            routes: await repo.learningRoutes.listLearningRoutes(
              owner,
              "",
              100,
            ),
            counts: await repo.getNativeLearningCounts(owner),
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
            accessToken: app.services.tokenService.issueAccessToken(
              owner.userId,
              "lighttick",
            ),
            user: { id: owner.userId, displayName: "课程回顾验收账号" },
          },
        }),
      );
      return;
    }
    if (
      failRead &&
      req.method === "GET" &&
      url.pathname.includes("/course-reviews/")
    ) {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_READ",
          message: "合成读取故障",
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
    const r = await app.app.handle({
      method: req.method!,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams),
      headers,
      body: raw ? JSON.parse(raw) : undefined,
    } as any);
    if (drop && ["POST", "PUT"].includes(req.method!) && r.statusCode < 400) {
      drop = false;
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "FIXTURE_DROP",
          message: "合成提交响应中断",
          data: null,
        }),
      );
      return;
    }
    res.statusCode = r.statusCode;
    res.end(JSON.stringify(r.body));
  } catch (e) {
    res.statusCode = 500;
    res.end(
      JSON.stringify({
        code: "FIXTURE_ERROR",
        message: (e as Error).message,
        data: null,
      }),
    );
  }
});
server.listen(3195, "127.0.0.1", () =>
  console.log(
    "Course review UI fixture ready http://127.0.0.1:3195/grow/course-review?collection=review-ui-course",
  ),
);
