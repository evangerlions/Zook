import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner, LightTickAiRunRow } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickAiSceneName } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotencyKeyOf, idempotent, numberOf, recordFact, response, stringOf } from "./lighttick-v1-http.ts";
import { profileData, goalData, taskData, variantsData, runData } from "./lighttick-route-mappers.ts";
import { readWeeklyPlanningCapacity, saveWeeklyPlanningCapacity } from "../modules/lighttick/planning/weekly-capacity.ts";
import { LIGHTTICK_APP_ID } from "../modules/lighttick/lighttick-app.ts";
import { handleStarterRequest } from "./lighttick-starter-routes.ts";
const PREFIX = "/api/v1/lighttick/";
type Json = Record<string, unknown>;
type CreateRun = (kind: string, sceneName: LightTickAiSceneName, resourceId: string | undefined, input: Json) => Promise<LightTickAiRunRow>;

/** 档案、周容量预算与引导流程：共用 owner/幂等/审计语义，独立成模块避免主分发器继续膨胀。 */
export async function handleProfileOnboardingRequest(context: BackendRouteContext, runtime: LightTickRuntime,
  authUserId: string, owner: LightTickOwner, request: HttpRequest, assertActive: () => Promise<void>,
  createRun: CreateRun): Promise<HttpResponse<unknown> | undefined> {
  if (request.path === `${PREFIX}profile` && request.method === "GET") {
    const profile = await runtime.profile.getProfile(owner);
    return response(context, request, profileData(profile) ?? { user_id: authUserId, app_id: LIGHTTICK_APP_ID, version: 0, onboarding_state: "not_started" });
  }
  if (request.path === `${PREFIX}profile` && request.method === "PATCH") {
    const body = bodyOf(request);
    const base = numberOf(body.base_version, "base_version");
    if (base < 0) throw new ApplicationError(400, "REQ_INVALID_BODY", "base_version must be nonnegative.");
    const update = async () => profileData(await runtime.profile.updateProfile(owner, base, {
      timezone: body.timezone as string | undefined, locale: body.locale as string | undefined,
      pace: body.pace as any, notificationPreferences: body.notification_preferences as Json | undefined }));
    const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
    const data = base === 0 || key !== undefined
      ? await idempotent(runtime, owner, request, "profile", owner.userId, "update", update)
      : await update();
    return response(context, request, data);
  }
  if (request.path === `${PREFIX}planning-capacity`) {
    const now = runtime.today.now();
    if (!["GET", "PATCH"].includes(request.method))
      throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
    const data = request.method === "GET"
      ? await readWeeklyPlanningCapacity(runtime.repository, owner, now, request.query?.date)
      : await idempotent(runtime, owner, request, "planning_capacity", owner.userId, "update", async () => {
        await assertActive();
        return saveWeeklyPlanningCapacity(runtime.repository, owner, bodyOf(request), now);
      });
    const result = response(context, request, data);
    result.headers = { ...result.headers, "Cache-Control": "no-store" };
    return result;
  }
  if (request.path === `${PREFIX}onboarding` && request.method === "POST") {
    const data = await idempotent(runtime, owner, request, "profile", authUserId, "onboarding", async () => {
      const body = bodyOf(request); const saved = await runtime.profile.submitOnboarding(owner, {
        title: stringOf(body.title, "title"), description: body.description as string | undefined,
        currentLevel: stringOf(body.current_level, "current_level"), weeklyAvailableMinutes: numberOf(body.weekly_available_minutes, "weekly_available_minutes"),
        pace: body.pace as any, timezone: stringOf(body.timezone, "timezone"), targetDate: body.target_date as string | undefined,
        durationMonths: body.duration_months as number | undefined, motivation: body.motivation as string | undefined,
        availabilityWindows: Array.isArray(body.availability_windows) ? body.availability_windows.map((item: any) => ({
          weekday: item.weekday, startTime: item.start_time, endTime: item.end_time })) : undefined });
      return runData(await createRun("onboarding_plan", "onboarding_plan", saved.goal.id, body));
    });
    await runtime.jobs?.enqueueAiRun(owner, (data as any).id, "onboarding_plan");
    return response(context, request, data, 202);
  }
  const starter = await handleStarterRequest(context, runtime, owner, request);
  if (starter) return starter;
  if (request.path === `${PREFIX}onboarding/first-action` && request.method === "POST") {
    const body = bodyOf(request); const operationId = idempotencyKeyOf(request);
    const data = await idempotent(runtime, owner, request, "task",
      String(body.task_id), "progressive_first_action", async () => {
        const result = await runtime.progressive.completeFirstAction(owner, { taskId: stringOf(body.task_id, "task_id"),
          baseVersion: numberOf(body.base_version, "base_version"), selectedVariant: body.selected_variant as any,
          actualMinutes: numberOf(body.actual_duration_minutes, "actual_duration_minutes"), difficulty: body.difficulty as string | undefined });
        return { feedback: result.feedback, three_day_preview: result.threeDayPreview.map(task => taskData(task)),
          weekly_commitment: result.weeklyCommitment };
      });
    const taskId = String(body.task_id);
    await recordFact(runtime, request, authUserId, "lighttick_starter_started", operationId, "onboarding",
      { operation_id: operationId, resource_id: taskId, variant: body.selected_variant, actual_minutes: body.actual_duration_minutes });
    await recordFact(runtime, request, authUserId, "lighttick_starter_completed", operationId, "onboarding",
      { operation_id: operationId, resource_id: taskId, variant: body.selected_variant, actual_minutes: body.actual_duration_minutes });
    await recordFact(runtime, request, authUserId, "lighttick_preview_viewed", operationId, "onboarding",
      { operation_id: operationId, resource_id: taskId, result: "returned" });
    return response(context, request, data);
  }
  if (request.path === `${PREFIX}onboarding/commitment` && request.method === "GET") {
    return response(context, request, await runtime.progressive.commitmentState(owner));
  }
  if (request.path === `${PREFIX}onboarding/commitment` && request.method === "POST") {
    const body = bodyOf(request); const operationId = idempotencyKeyOf(request);
    const data = await idempotent(runtime, owner, request, "goal",
      String(body.goal_id), "progressive_commitment", async () => {
        const result = await runtime.progressive.selectCommitment(owner, { goalId: stringOf(body.goal_id, "goal_id"),
          mode: body.mode as any, deepPlanning: body.deep_planning === true });
        return { goal_id: result.goalId, status: result.status, commitment_mode: result.commitmentMode,
          valid_action_count: result.validActionCount };
      });
    await recordFact(runtime, request, authUserId, "lighttick_weekly_commitment", operationId, "onboarding",
      { operation_id: operationId, goal_id: body.goal_id, mode: body.mode, valid_action_count: (data as any).valid_action_count });
    return response(context, request, data);
  }
  const runMatch = request.path.match(/^\/api\/v1\/lighttick\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const run = await runtime.repository.getAiRun(owner, runMatch[1]!);
    if (!run) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Run was not found.");
    return response(context, request, runData(run));
  }
  return undefined;
}
