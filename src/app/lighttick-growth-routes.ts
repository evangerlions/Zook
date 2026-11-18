import { LIGHTTICK_APP_ID } from "../modules/lighttick/lighttick-app.ts";
import { businessDateAt } from "../modules/lighttick/lighttick-today.service.ts";
import { buildGrowthOverview } from "../modules/lighttick/growth/lighttick-growth.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

/**
 * 成长总览：把已有的任务事实聚合成「什么时候投入了多少」。
 *
 * 不新建实体，也不做 AI 推断——只做口径明确的计数与求和，
 * 让界面上的数字可以被任务列表逐条对上。
 */
const PREFIX = "/api/v1/lighttick/";
const OVERVIEW_PATH = `${PREFIX}growth/overview`;
const MAX_HEATMAP_DAYS = 366;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** 形状对不等于日期真实存在：2026-13-99 也匹配 DATE_PATTERN，必须再走一次日历往返。 */
function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year!, month! - 1, day!)).toISOString().slice(0, 10) === value;
}

function response(context: BackendRouteContext, request: HttpRequest, data: unknown) {
  return context.ok(data, request.requestId as string);
}

export async function tryHandleLightTickGrowthRoutes(
  context: BackendRouteContext,
  enabled: boolean,
  runtime: LightTickRuntime | undefined,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.path !== OVERVIEW_PATH) return undefined;
  if (!enabled || !runtime)
    throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LightTick is not enabled for this deployment.");
  if (request.method !== "GET")
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Use GET for the growth overview.");

  const auth = await context.authenticateProductRequest(request, LIGHTTICK_APP_ID);
  await runtime.scopePolicy.assertRequest(request);
  const owner: LightTickOwner = { appId: LIGHTTICK_APP_ID, userId: auth.userId };
  const guest = runtime.guestIdentity ? await runtime.guestIdentity.getActive(auth.userId) : undefined;
  if (guest)
    throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Guest sessions cannot access this LightTick capability.");

  const profile = await runtime.repository.getProfile(owner);
  const timezone = profile?.timezone ?? "UTC";

  const requestedDate = request.query?.date?.trim();
  if (requestedDate && !isCalendarDate(requestedDate))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "date must be a real calendar date in YYYY-MM-DD.");
  const today = requestedDate || businessDateAt(new Date(), timezone);

  const requestedDays = request.query?.days?.trim();
  const heatmapDays = requestedDays === undefined ? 120 : Number(requestedDays);
  if (!Number.isInteger(heatmapDays) || heatmapDays < 1 || heatmapDays > MAX_HEATMAP_DAYS)
    throw new ApplicationError(400, "REQ_FIELD_INVALID", `days must be an integer between 1 and ${MAX_HEATMAP_DAYS}.`);

  const tasks = await runtime.repository.listTasks(owner);
  return response(
    context,
    request,
    buildGrowthOverview(
      tasks.map((task) => ({
        status: task.status,
        scheduledFor: task.scheduledFor,
        completedAt: task.completedAt,
        estimatedMinutes: task.estimatedMinutes,
        actualMinutes: task.actualMinutes,
      })),
      { today, timezone, heatmapDays },
    ),
  );
}
