import { LIGHTTICK_APP_ID } from "../modules/lighttick/lighttick-app.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { randomId, sha256 } from "../shared/utils.ts";
import { assertIanaTimezone } from "../modules/lighttick/lighttick-profile.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const PREFIX = "/api/v1/lighttick/";
type Json = Record<string, unknown>;

function bodyOf(request: HttpRequest): Json {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Request body must be an object.");
  return request.body as Json;
}
function numberOf(value: unknown, field: string): number {
  if (!Number.isInteger(value)) throw new ApplicationError(400, "REQ_FIELD_REQUIRED", `${field} is required.`);
  return value as number;
}
function stringOf(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ApplicationError(400, "REQ_FIELD_REQUIRED", `${field} is required.`);
  return value.trim();
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Json).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
function response(context: BackendRouteContext, request: HttpRequest, data: unknown, statusCode = 200) {
  const value = context.ok(data, request.requestId as string);
  value.statusCode = statusCode;
  if (statusCode === 201) { value.body.code = "CREATED"; value.body.message = "created"; }
  if (statusCode === 202) { value.body.code = "ACCEPTED"; value.body.message = "accepted"; }
  return value;
}
function profileData(row: any) { return row ? { user_id: row.userId, timezone: row.timezone, locale: row.locale,
  pace: row.pace, onboarding_state: row.onboardingState, notification_preferences: row.notificationPreferences,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt } : undefined; }
function goalData(row: any) { return { id: row.id, title: row.title, description: row.description, status: row.status,
  target_date: row.targetDate, constraints: row.constraints, pause_metadata: row.pauseMetadata ? {
    reason: row.pauseMetadata.reason, paused_at: row.pauseMetadata.pausedAt,
    expected_resume_at: row.pauseMetadata.expectedResumeAt, keep_light_tasks: row.pauseMetadata.keepLightTasks,
    notification_policy: row.pauseMetadata.notificationPolicy } : undefined,
  recovery_started_at: row.recoveryStartedAt, version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
function variantData(definition: any) { return { title: definition.title,
  estimated_duration_minutes: definition.estimatedMinutes, completion_criteria: definition.completionCriteria }; }
function variantsData(definitions: any) { return definitions ? Object.fromEntries(Object.entries(definitions)
  .map(([key, value]) => [key, variantData(value)])) : undefined; }
function taskData(row: any) { return { id: row.id, goal_id: row.goalId, plan_id: row.planId, title: row.title,
  status: row.status, scheduled_date: row.scheduledFor?.slice(0, 10), estimated_duration_minutes: row.estimatedMinutes,
  lineage_id: row.lineageId ?? row.id, selected_variant: row.selectedVariant ?? "standard",
  variants: variantsData(row.variantDefinitions), completion_criteria: row.completionCriteria,
  actual_duration_minutes: row.actualMinutes, commitment_satisfied: row.commitmentSatisfied,
  priority: row.priority, completed_at: row.completedAt, note: row.notes, version: row.version,
  created_at: row.createdAt, updated_at: row.updatedAt }; }
function planData(row: any, tasks?: any[]) { return { id: row.id, goal_id: row.goalId, granularity: row.granularity,
  status: row.status, period_start: row.periodStart, period_end: row.periodEnd, source: row.source,
  ...(tasks ? { tasks: tasks.map(taskData) } : {}), version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
function reviewData(row: any) { return { id: row.id, goal_id: row.goalId, period: row.period === "week" ? "weekly" : "monthly",
  status: row.status, period_start: row.periodStart, period_end: row.periodEnd, facts: row.facts,
  insights: row.output?.insights ?? [], recommendations: row.output?.recommendations ?? [], data_sufficiency: row.dataSufficiency,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
function proposalData(row: any) { return { id: row.id, plan_id: row.planId, base_plan_version: row.basePlanVersion,
  status: row.status, reason: row.reason, diff: row.diff, impact: row.impact, expires_at: row.expiresAt,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
function runData(row: LightTickAiRunRow) { return { id: row.id, kind: row.kind, scene: row.sceneKey, status: row.status,
  retryable: row.status === "failed", result_resource_id: row.resourceId, error_code: row.errorCode,
  created_at: row.createdAt, updated_at: row.updatedAt }; }

async function idempotent<T>(runtime: LightTickRuntime, owner: LightTickOwner, request: HttpRequest,
  entityType: string, entityId: string, action: string, execute: () => Promise<T>): Promise<T> {
  const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
  if (!key || key.length < 8 || key.length > 128) throw new ApplicationError(400, "REQ_FIELD_REQUIRED", "Idempotency-Key is required.");
  const payload = bodyOf(request); const payloadHash = sha256(canonical(payload));
  return await runtime.repository.transaction(owner, async () => {
    const existing = await runtime.repository.getOperation(owner, key);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.action !== action)
        throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
      return structuredClone(existing.resultPayload) as T;
    }
    const result = await execute(); const now = new Date().toISOString();
    const saved = await runtime.repository.saveOperation({ ...owner, operationId: key, deviceId: "http",
      payloadHash, entityType, entityId, action, requestPayload: payload,
      resultPayload: structuredClone(result) as Json, status: "accepted", createdAt: now, updatedAt: now });
    if (saved.payloadHash !== payloadHash) throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key collision.");
    return structuredClone(saved.resultPayload) as T;
  });
}

async function createRun(runtime: LightTickRuntime, owner: LightTickOwner, kind: string, sceneKey: string,
  resourceId: string | undefined, input: Json): Promise<LightTickAiRunRow> {
  const now = new Date().toISOString();
  return await runtime.repository.saveAiRun({ ...owner, id: randomId("lighttick_run"), kind, status: "queued",
    resourceId, sceneKey, promptVersion: "v1", schemaVersion: "v1", attemptCount: 0,
    inputContext: input, usage: {}, createdAt: now, updatedAt: now });
}

export async function tryHandleLightTickV1Routes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(PREFIX)) return undefined;
  if (!enabled || !runtime) throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LightTick is not enabled for this deployment.");
  const auth = await context.authenticateProductRequest(request, LIGHTTICK_APP_ID);
  const owner: LightTickOwner = { appId: LIGHTTICK_APP_ID, userId: auth.userId };

  if (request.method === "DELETE" && request.path === `${PREFIX}me/account`) {
    const body = bodyOf(request); const confirmation = stringOf(body.confirmation, "confirmation");
    const result = await context.authService.deleteCurrentAppAccount({ appId: LIGHTTICK_APP_ID, userId: auth.userId, confirmation });
    await runtime.repository.deleteOwnerData(owner);
    return context.ok({ app_id: LIGHTTICK_APP_ID, membership_status: "DELETED", sessions_revoked: result.revokedSessions,
      product_data_deleted: result.deleted }, request.requestId as string, { "Set-Cookie": context.authService.buildClearRefreshCookie() });
  }
  if (request.path === `${PREFIX}profile` && request.method === "GET") {
    const profile = await runtime.profile.getProfile(owner);
    return response(context, request, profileData(profile) ?? { user_id: auth.userId, app_id: LIGHTTICK_APP_ID, onboarding_state: "not_started" });
  }
  if (request.path === `${PREFIX}profile` && request.method === "PATCH") {
    const body = bodyOf(request); const row = await runtime.profile.updateProfile(owner, numberOf(body.base_version, "base_version"), {
      timezone: body.timezone as string | undefined, locale: body.locale as string | undefined,
      pace: body.pace as any, notificationPreferences: body.notification_preferences as Json | undefined });
    return response(context, request, profileData(row));
  }
  if (request.path === `${PREFIX}onboarding` && request.method === "POST") {
    const data = await idempotent(runtime, owner, request, "profile", auth.userId, "onboarding", async () => {
      const body = bodyOf(request); const saved = await runtime.profile.submitOnboarding(owner, {
        title: stringOf(body.title, "title"), description: body.description as string | undefined,
        currentLevel: stringOf(body.current_level, "current_level"), weeklyAvailableMinutes: numberOf(body.weekly_available_minutes, "weekly_available_minutes"),
        pace: body.pace as any, timezone: stringOf(body.timezone, "timezone"), targetDate: body.target_date as string | undefined,
        durationMonths: body.duration_months as number | undefined, motivation: body.motivation as string | undefined,
        availabilityWindows: Array.isArray(body.availability_windows) ? body.availability_windows.map((item: any) => ({
          weekday: item.weekday, startTime: item.start_time, endTime: item.end_time })) : undefined });
      return runData(await createRun(runtime, owner, "onboarding_plan", "lighttick_onboarding_plan_v1", saved.goal.id, body));
    });
    await runtime.jobs?.enqueueAiRun(owner, (data as any).id, "onboarding_plan");
    return response(context, request, data, 202);
  }
  if (request.path === `${PREFIX}onboarding/starter` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "profile", auth.userId, "progressive_starter", async () => {
      const result = await runtime.progressive.createStarter(owner, { wish: stringOf(body.wish, "wish"),
        timezone: stringOf(body.timezone, "timezone"), locale: body.locale as string | undefined });
      return { source: result.source, wish: result.wish, assumption: result.assumption, goal: goalData(result.goal),
        recommended: taskData(result.recommended), alternatives: result.alternatives.map(item => ({ candidate_id: item.candidateId,
          title: item.title, assumption: item.assumption, variants: variantsData(item.variants) })) };
    });
    return response(context, request, data, 201);
  }
  if (request.path === `${PREFIX}onboarding/first-action` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "task",
      String(body.task_id), "progressive_first_action", async () => {
        const result = await runtime.progressive.completeFirstAction(owner, { taskId: stringOf(body.task_id, "task_id"),
          baseVersion: numberOf(body.base_version, "base_version"), selectedVariant: body.selected_variant as any,
          actualMinutes: numberOf(body.actual_duration_minutes, "actual_duration_minutes"), difficulty: body.difficulty as string | undefined });
        return { feedback: result.feedback, three_day_preview: result.threeDayPreview.map(taskData),
          weekly_commitment: result.weeklyCommitment };
      });
    return response(context, request, data);
  }
  if (request.path === `${PREFIX}onboarding/commitment` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "goal",
      String(body.goal_id), "progressive_commitment", async () => {
        const result = await runtime.progressive.selectCommitment(owner, { goalId: stringOf(body.goal_id, "goal_id"),
          mode: body.mode as any, deepPlanning: body.deep_planning === true });
        return { goal_id: result.goalId, status: result.status, commitment_mode: result.commitmentMode,
          valid_action_count: result.validActionCount };
      });
    return response(context, request, data);
  }
  const runMatch = request.path.match(/^\/api\/v1\/lighttick\/runs\/([^/]+)$/);
  if (runMatch && request.method === "GET") {
    const run = await runtime.repository.getAiRun(owner, runMatch[1]!);
    if (!run) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Run was not found.");
    return response(context, request, runData(run));
  }

  if (request.path === `${PREFIX}goals` && request.method === "GET")
    return response(context, request, { items: (await runtime.goals.list(owner)).map(goalData), next_cursor: null });
  if (request.path === `${PREFIX}goals` && request.method === "POST") {
    const data = await idempotent(runtime, owner, request, "goal", "new", "create", async () => goalData(await runtime.goals.create(owner, {
      title: stringOf(bodyOf(request).title, "title"), description: bodyOf(request).description as string | undefined,
      targetDate: bodyOf(request).target_date as string | undefined, constraints: bodyOf(request).constraints as Json ?? {} })));
    return response(context, request, data, 201);
  }
  const goalMatch = request.path.match(/^\/api\/v1\/lighttick\/goals\/([^/]+)$/);
  if (goalMatch && request.method === "GET") return response(context, request, goalData(await runtime.goals.get(owner, goalMatch[1]!)));
  if (goalMatch && request.method === "PATCH") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "goal", goalMatch[1]!, "update", async () =>
      goalData(await runtime.goals.update(owner, goalMatch[1]!, numberOf(body.base_version, "base_version"), {
        title: body.title as string | undefined, description: body.description as string | undefined,
        targetDate: body.target_date as string | undefined, constraints: body.constraints as Json | undefined })));
    return response(context, request, data);
  }
  const lifecycleMatch = request.path.match(/^\/api\/v1\/lighttick\/goals\/([^/]+)\/lifecycle$/);
  if (lifecycleMatch && request.method === "POST") {
    const body = bodyOf(request); const action = stringOf(body.action, "action") as "pause" | "resume" | "complete" | "archive";
    if (!["pause", "resume", "complete", "archive"].includes(action)) throw new ApplicationError(400, "REQ_FIELD_INVALID", "action is invalid.");
    const data = await idempotent(runtime, owner, request, "goal", lifecycleMatch[1]!, action, async () =>
      goalData(await runtime.goals.transition(owner, lifecycleMatch[1]!, numberOf(body.base_version, "base_version"), action, {
        reason: body.reason as string | undefined, expectedResumeAt: body.expected_resume_at as string | undefined,
        keepLightTasks: body.keep_light_tasks as boolean | undefined, notificationPolicy: body.notification_policy as any,
        resumeMode: body.resume_mode as any })));
    return response(context, request, data);
  }
  if (request.path === `${PREFIX}plan-runs` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "plan", String(body.goal_id), "generate", async () => {
      await runtime.goals.get(owner, stringOf(body.goal_id, "goal_id"));
      return runData(await createRun(runtime, owner, "plan", `lighttick_plan_${String(body.granularity)}`, String(body.goal_id), body));
    });
    const planScene = `${String(body.granularity)}_plan` as "month_plan" | "week_plan" | "day_plan";
    await runtime.jobs?.enqueueAiRun(owner, (data as any).id, planScene); return response(context, request, data, 202);
  }
  const planMatch = request.path.match(/^\/api\/v1\/lighttick\/plans\/([^/]+)$/);
  if (planMatch && request.method === "GET") {
    const plan = await runtime.repository.getPlan(owner, planMatch[1]!);
    if (!plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
    return response(context, request, planData(plan, await runtime.repository.listTasks(owner, plan.id)));
  }
  const confirmMatch = request.path.match(/^\/api\/v1\/lighttick\/plans\/([^/]+)\/confirm$/);
  if (confirmMatch && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "plan", confirmMatch[1]!, "confirm", async () => {
      const saved = await runtime.plans.confirm(owner, confirmMatch[1]!, numberOf(body.base_version, "base_version"));
      return planData(saved.plan, saved.tasks);
    }); return response(context, request, data);
  }
  const planTasksMatch = request.path.match(/^\/api\/v1\/lighttick\/plans\/([^/]+)\/tasks$/);
  if (planTasksMatch && request.method === "GET") {
    const plan = await runtime.repository.getPlan(owner, planTasksMatch[1]!);
    if (!plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
    return response(context, request, { items: (await runtime.repository.listTasks(owner, plan.id)).map(taskData), next_cursor: null });
  }
  if (request.path === `${PREFIX}today` && request.method === "GET") {
    const today = await runtime.today.get(owner); return response(context, request, { business_date: today.businessDate,
      timezone: today.timezone, primary_task: today.primaryTask ? taskData(today.primaryTask) : undefined,
      tasks: today.executableTasks.map(taskData), completed_tasks: today.completedTasks.map(taskData),
      remaining_estimated_minutes: today.remainingEstimatedMinutes, plan_b_available: today.planBAvailable,
      empty_state_action: today.emptyState === "goal_paused" ? "resume_goal" : today.emptyState === "no_active_plan" ? "generate_plan" : today.emptyState === "no_tasks_today" ? "rest" : "none",
      snapshot_version: today.snapshotVersion });
  }
  const taskMatch = request.path.match(/^\/api\/v1\/lighttick\/tasks\/([^/]+)\/(start|complete|skip|defer|cancel)$/);
  if (taskMatch && request.method === "POST") {
    const body = bodyOf(request); const action = taskMatch[2]!; const command: any = action === "complete"
      ? { action, actualMinutes: body.actual_duration_minutes, notes: body.note }
      : action === "skip" ? { action, reason: body.reason_code === "no_longer_relevant" ? "not_relevant" : body.reason_code, notes: body.reason_note }
      : action === "defer" ? { action, scheduledFor: `${stringOf(body.target_date, "target_date")}T12:00:00.000Z`, notes: body.reason_note }
      : { action };
    const data = await idempotent(runtime, owner, request, "task", taskMatch[1]!, action, async () =>
      taskData(await runtime.tasks.command(owner, taskMatch[1]!, numberOf(body.base_version, "base_version"), command)));
    return response(context, request, data);
  }
  const variantMatch = request.path.match(/^\/api\/v1\/lighttick\/tasks\/([^/]+)\/variant$/);
  if (variantMatch && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "task", variantMatch[1]!, "variant", async () =>
      taskData(await runtime.tasks.switchVariant(owner, variantMatch[1]!, numberOf(body.base_version, "base_version"), body.variant as any)));
    return response(context, request, data);
  }

  if (request.path === `${PREFIX}review-runs` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "review", String(body.goal_id), "generate", async () => {
      const review = await runtime.reviews.create(owner, stringOf(body.goal_id, "goal_id"), body.period === "monthly" ? "month" : "week",
        stringOf(body.period_start, "period_start"), stringOf(body.period_end, "period_end"));
      const run = await createRun(runtime, owner, "review", `lighttick_${body.period}_review_v1`, review.id, body);
      return runData(run);
    });
    await runtime.jobs?.enqueueReview(owner, (data as any).id, body.period === "monthly" ? "monthly_review" : "weekly_review");
    return response(context, request, data, 202);
  }
  if (request.path === `${PREFIX}reviews` && request.method === "GET")
    return response(context, request, { items: (await runtime.repository.listReviews(owner)).map(reviewData), next_cursor: null });
  const reviewMatch = request.path.match(/^\/api\/v1\/lighttick\/reviews\/([^/]+)$/);
  if (reviewMatch && request.method === "GET") {
    const review = (await runtime.repository.listReviews(owner)).find(item => item.id === reviewMatch[1]);
    if (!review) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Review was not found.");
    return response(context, request, reviewData(review));
  }
  if (request.path === `${PREFIX}change-proposal-runs` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "change_proposal", String(body.plan_id), "generate", async () => {
      const plan = await runtime.repository.getPlan(owner, stringOf(body.plan_id, "plan_id"));
      if (!plan) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
      if (plan.version !== numberOf(body.base_version, "base_version")) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Plan version is stale.");
      return runData(await createRun(runtime, owner, "change_proposal", "lighttick_change_proposal_v1", plan.id, body));
    }); await runtime.jobs?.enqueueAiRun(owner, (data as any).id, "change_proposal"); return response(context, request, data, 202);
  }
  const proposalMatch = request.path.match(/^\/api\/v1\/lighttick\/change-proposals\/([^/]+)$/);
  if (proposalMatch && request.method === "GET") {
    const proposal = await runtime.repository.getProposal(owner, proposalMatch[1]!);
    if (!proposal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Change proposal was not found.");
    return response(context, request, proposalData(proposal));
  }
  const decisionMatch = request.path.match(/^\/api\/v1\/lighttick\/change-proposals\/([^/]+)\/(accept|reject)$/);
  if (decisionMatch && request.method === "POST") {
    const body = bodyOf(request); const action = decisionMatch[2]!; const data = await idempotent(runtime, owner, request,
      "change_proposal", decisionMatch[1]!, action, async () => action === "accept"
        ? proposalData((await runtime.proposals.accept(owner, decisionMatch[1]!, numberOf(body.base_version, "base_version"))).proposal)
        : proposalData(await runtime.proposals.reject(owner, decisionMatch[1]!, numberOf(body.base_version, "base_version"))));
    return response(context, request, data);
  }
  if (request.path === `${PREFIX}sync/push` && request.method === "POST") {
    const operations = bodyOf(request).operations;
    return response(context, request, await runtime.sync.push(owner, operations as any[]));
  }
  if (request.path === `${PREFIX}sync/pull` && request.method === "GET") {
    const limit = request.query?.limit === undefined ? 100 : Number(request.query.limit);
    return response(context, request, await runtime.sync.pull(owner, request.query?.cursor, limit));
  }
  if (request.path === `${PREFIX}devices` && request.method === "POST") {
    const body = bodyOf(request); const data = await idempotent(runtime, owner, request, "device", String(body.device_id), "register", async () => {
      const timezone = stringOf(body.timezone, "timezone"); assertIanaTimezone(timezone); const now = new Date().toISOString();
      const platform = stringOf(body.platform, "platform"); const pushProvider = stringOf(body.push_provider, "push_provider");
      const pushToken = stringOf(body.push_token, "push_token");
      if (![["ios", "apns"], ["android", "fcm"]].some(([candidatePlatform, candidateProvider]) =>
        platform === candidatePlatform && pushProvider === candidateProvider) || pushToken.length < 16 || pushToken.length > 4096)
        throw new ApplicationError(400, "REQ_FIELD_INVALID", "Device platform, provider, or push token is invalid.");
      const device = await runtime.repository.upsertDevice({ ...owner, id: stringOf(body.device_id, "device_id"),
        platform: platform as any, pushProvider: pushProvider as any, pushToken, timezone, locale: stringOf(body.locale, "locale"),
        appVersion: stringOf(body.app_version, "app_version"), notificationsEnabled: body.notifications_enabled !== false,
        active: true, createdAt: now, updatedAt: now });
      return { id: device.id, platform: device.platform, push_provider: device.pushProvider, timezone: device.timezone,
        locale: device.locale, app_version: device.appVersion, active: device.active, created_at: device.createdAt, updated_at: device.updatedAt };
    }); return response(context, request, data);
  }
  const deviceMatch = request.path.match(/^\/api\/v1\/lighttick\/devices\/([^/]+)$/);
  if (deviceMatch && request.method === "DELETE") {
    const removed = await runtime.repository.deleteDevice(owner, deviceMatch[1]!, new Date().toISOString());
    if (!removed) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Device was not found.");
    return response(context, request, { id: deviceMatch[1], active: false });
  }
  return undefined;
}
