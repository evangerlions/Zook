/** Local synthetic learning-review acceptance server. No real accounts or model/GitHub requests. */
import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { Pool } from "pg";
import { createApplication } from "./create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL,
  webRoot = process.env.LIGHTTICK_TEST_WEB_ROOT;
if (
  !dsn ||
  !webRoot ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_learning_review_")
)
  throw Error(
    "Dedicated synthetic learning-review database and Web root required",
  );
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn }),
  repo = new PostgresLightTickRepository(pool);
const owner = { appId: "lighttick" as const, userId: "user_alice" },
  seed = buildDefaultSeed(undefined, { includeLightTick: true });
seed.appUsers.push({
  ...owner,
  id: "learning-review-browser",
  status: "ACTIVE",
  accountRegion: "UNKNOWN",
  joinedAt: new Date().toISOString(),
});
const config = seed.appConfigs.find(
  (c) => c.appId === "lighttick" && c.configKey === "admin.delivery_config",
)!;
const value = JSON.parse(config.configValue);
config.configValue = JSON.stringify({
  ...value,
  settings: { ...value.settings, runtimeScope: "core" },
});
const runtime = await createApplication({
  seed,
  lighttickEnabled: true,
  lighttickRepository: repo,
});
await repo.deleteOwnerData(owner);
let seedClock: Date | null = new Date("2026-11-14T08:00:00Z");
const native = new NativeLearningService(
  repo,
  true,
  () => seedClock ?? new Date(),
);
runtime.services.lighttickRuntime!.nativeLearning = native;
await repo.saveProfile({
  ...owner,
  timezone: "Asia/Shanghai",
  locale: "zh-CN",
  pace: "balanced",
  onboardingState: "none",
  notificationPreferences: {},
  onboardingDraft: {},
  version: 1,
  createdAt: seedClock!.toISOString(),
  updatedAt: seedClock!.toISOString(),
});
await native.saveCollection(
  owner,
  "review-english",
  {
    base_revision: 0,
    title: "英文课程",
    module_id: "english-reading",
    archived: false,
  },
  "browser-collection-en",
);
await native.saveCollection(
  owner,
  "review-expression",
  {
    base_revision: 0,
    title: "表达课程",
    module_id: "structured-expression",
    archived: false,
  },
  "browser-collection-ex",
);
for (let i = 1; i <= 25; i++) {
  seedClock = new Date(
    i === 1
      ? "2026-10-31T16:30:00Z"
      : i === 25
        ? "2026-11-03T08:00:00Z"
        : "2026-11-02T08:00:00Z",
  );
  const id = "lesson-review-ui-" + String(i).padStart(3, "0"),
    english = i <= 23;
  const lesson = await native.publish(
    owner,
    id,
    {
      base_revision: 0,
      collection_id: english ? "review-english" : "review-expression",
      number: i,
      title: (english ? "英文学习 " : "表达学习 ") + i,
      content: i === 1 ? "# 旧版本正文\n原始学习完成记录" : "# 课程正文 " + i,
      references: "",
    },
    "browser-publish-" + i,
  );
  await native.privateCommand(
    owner,
    id,
    {
      action: "complete",
      content_version: lesson.content_version,
      base_revision: 0,
    },
    "browser-complete-" + i,
  );
  if (i === 1)
    await native.publish(
      owner,
      id,
      {
        base_revision: 1,
        collection_id: "review-english",
        number: i,
        title: "改版英文学习 1",
        content: "# 新版本正文",
        references: "",
      },
      "browser-republish-one",
    );
  if (i === 25) {
    const l = (await repo.getNativeLesson(owner, id))!;
    await repo.saveNativeLesson(
      { ...l, archived: true, revision: l.revision + 1 },
      l.revision,
    );
  }
}
const legacy = await native.publish(
  owner,
  "lesson-review-unknown",
  {
    base_revision: 0,
    collection_id: "review-english",
    number: 26,
    title: "旧系统无日期完成",
    content: "# Legacy",
    references: "",
  },
  "browser-unknown",
);
const l = (await repo.getNativeLesson(owner, legacy.id))!;
await repo.saveNativeLesson(
  {
    ...l,
    sourceCompleted: true,
    sourceCompletedVersion: legacy.content_version,
    revision: l.revision + 1,
  },
  l.revision,
);
await repo.formRecords.save(
  owner,
  {
    revision: 1,
    updated_at: new Date().toISOString(),
    data: {
      modules: [
        { id: "writing", name: "手工表达", color: "#777777", order: 0 },
      ],
      checkins: { "2026-11-04": { writing: 3 } },
      habits: { "2026-11-04": { minutes: 15, note: "合成补记" } },
      customFields: [],
      customRecords: [],
      decisions: [],
      predictions: [],
      reviews: [],
      insights: [],
      todos: [],
    },
  },
  0,
);
seedClock = null;
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
let fail = false;
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://127.0.0.1:3193");
  try {
    if (url.pathname.startsWith("/__learning-review/")) {
      res.setHeader("content-type", "application/json");
      if (url.pathname.endsWith("/fail")) fail = true;
      if (url.pathname.endsWith("/recover")) fail = false;
      if (url.pathname.endsWith("/revoke") || url.pathname.endsWith("/grant")) {
        const a = (await repo.getLearningAuthority(owner))!;
        await repo.saveLearningAuthority(
          {
            ...a,
            privateEnabled: url.pathname.endsWith("/grant"),
            revision: a.revision + 1,
          },
          a.revision,
        );
      }
      if (url.pathname.endsWith("/snapshot")) {
        res.end(JSON.stringify(await repo.getNativeLearningCounts(owner)));
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
            user: { id: owner.userId, displayName: "笔记验收账号" },
          },
        }),
      );
      return;
    }
    if (fail && url.pathname === "/api/v1/lighttick/learning/review") {
      res.statusCode = 503;
      res.end(
        JSON.stringify({
          code: "LIGHTTICK_APP_DISABLED",
          message: "Synthetic learning-review read failure",
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
server.listen(3193, "127.0.0.1", () =>
  console.log(
    "Learning review UI fixture ready http://127.0.0.1:3193/grow/growth/learning-review?month=2026-11",
  ),
);
