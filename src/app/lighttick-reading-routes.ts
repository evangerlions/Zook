import { LIGHTTICK_APP_ID } from "../modules/lighttick/lighttick-app.ts";
import { LIGHTTICK_AI_SCENES } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import { captureModel } from "../modules/lighttick/personal-model/personal-model.service.ts";
import { runData } from "./lighttick-route-mappers.ts";
import { ReadingService } from "../modules/lighttick/reading/reading.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { randomId } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

/**
 * 阅读域路由。
 *
 * 总开关沿用既有风格：`LIGHTTICK_READING_ENABLED=0` 显式关闭（关闭时全部 503），
 * 默认随 LightTick 主开关一起开启，避免本地还要记一个变量。
 *
 * 位置、反馈各自独立 CAS：存位置不该让「保存反馈」返回 409，反之亦然。
 */
const PREFIX = "/api/v1/lighttick/reading";
const ARTICLES = `${PREFIX}/articles`;
const DAILY = `${PREFIX}/daily`;
const ARTICLE_PATH = /^\/api\/v1\/lighttick\/reading\/articles\/([a-zA-Z0-9_-]{1,128})(?:\/(state|feedback|guide))?$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === value;
}

/**
 * 建导读 run。和 v1 路由里的 createRun 同一套字段，但那边是文件内私有函数，
 * 这里不为了复用去改一个同时在并行改动中的共享文件，先把 8 行重复写清楚。
 */
async function createGuideRun(runtime: LightTickRuntime, owner: LightTickOwner, articleId: string) {
  await runtime.scopePolicy.assertFull();
  const now = new Date().toISOString();
  const scene = LIGHTTICK_AI_SCENES.reading_guide;
  return await runtime.repository.saveAiRun({
    ...owner, id: randomId("lighttick_run"), kind: "reading_guide", status: "queued",
    resourceId: articleId, sceneKey: scene.key, promptVersion: scene.promptVersion,
    schemaVersion: scene.schemaVersion, attemptCount: 0,
    inputContext: { article_id: articleId, model_selection: await captureModel(runtime.repository, owner) },
    usage: {}, createdAt: now, updatedAt: now,
  });
}

export function readingEnabled(): boolean {
  return process.env.LIGHTTICK_READING_ENABLED !== "0";
}

export async function tryHandleLightTickReadingRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(PREFIX)) return undefined;
  if (!enabled || !runtime)
    throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LightTick is not enabled for this deployment.");
  if (!readingEnabled())
    throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "Reading is not enabled for this deployment.");

  const auth = await context.authenticateProductRequest(request, LIGHTTICK_APP_ID);
  await runtime.scopePolicy.assertRequest(request);
  const owner: LightTickOwner = { appId: LIGHTTICK_APP_ID, userId: auth.userId };
  const guest = runtime.guestIdentity ? await runtime.guestIdentity.getActive(auth.userId) : undefined;
  if (guest)
    throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Guest sessions cannot access this LightTick capability.");

  const service = new ReadingService(runtime.repository);
  const reply = (data: unknown, status?: number) => {
    const value = context.ok(data, request.requestId as string);
    if (status) value.statusCode = status;
    return value;
  };
  const body = (request.body ?? {}) as Record<string, unknown>;

  if (request.path === ARTICLES) {
    if (request.method === "GET")
      return reply(await service.list(owner, {
        q: request.query?.q,
        filter: request.query?.filter,
        topic: request.query?.topic,
      }));
    if (request.method === "POST") {
      const result = await service.create(owner, body);
      return reply({ article: result.article, duplicate: result.duplicate });
    }
    throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET or POST for reading articles.");
  }

  if (request.path === DAILY) {
    if (request.method !== "GET")
      throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET for the reading daily selection.");
    const requested = request.query?.date?.trim();
    if (requested && !isCalendarDate(requested))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "date must be a real calendar date in YYYY-MM-DD.");
    return reply(await service.daily(owner, requested || undefined));
  }

  const match = ARTICLE_PATH.exec(request.path);
  if (!match) return undefined;
  const [, id, action] = match;

  if (action === "state") {
    if (request.method !== "PUT")
      throw new ApplicationError(405, "VALIDATION_ERROR", "Use PUT for reading position.");
    return reply(await service.saveState(owner, id!, body));
  }
  if (action === "feedback") {
    if (request.method !== "PUT")
      throw new ApplicationError(405, "VALIDATION_ERROR", "Use PUT for reading feedback.");
    return reply(await service.saveFeedback(owner, id!, body));
  }
  if (action === "guide") {
    if (request.method !== "POST")
      throw new ApplicationError(405, "VALIDATION_ERROR", "Use POST to generate a reading guide.");
    // 先确认文章属于本人，再建 run；异步生成，前端轮询 /runs/{id} 后重取详情。
    await service.detail(owner, id!);
    const run = await createGuideRun(runtime, owner, id!);
    await runtime.jobs?.enqueueAiRun(owner, run.id, "reading_guide");
    return reply(runData(run), 202);
  }

  if (request.method === "GET") return reply(await service.detail(owner, id!));
  if (request.method === "PATCH") return reply(await service.update(owner, id!, body));
  if (request.method === "DELETE") return reply(await service.remove(owner, id!));
  throw new ApplicationError(405, "VALIDATION_ERROR", "Use GET, PATCH or DELETE for a reading article.");
}
