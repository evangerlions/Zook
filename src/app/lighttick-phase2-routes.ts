import { LIGHTTICK_APP_ID } from "../modules/lighttick/lighttick-app.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { randomId, sha256 } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickServerEvent } from "../modules/lighttick/lighttick-analytics.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";

/**
 * Phase 2 LightTick routes: evidence-driven execution facts and multi-turn
 * Coach chat. Kept in a separate file so the Phase 1 router stays within the
 * source line-count gate. Guests are not allowed here: chat and execution
 * facts belong to registered accounts.
 */
const PREFIX = "/api/v1/lighttick/";
type Json = Record<string, unknown>;

function bodyOf(request: HttpRequest): Json {
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Request body must be an object.");
  return request.body as Json;
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
function analyticsPlatform(request: HttpRequest): "ios" | "android" | "web" {
  const bodyPlatform = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? (request.body as Json).platform : undefined;
  const value = bodyPlatform ?? request.headers["x-client-platform"] ?? request.headers["X-Client-Platform"];
  return value === "ios" || value === "android" ? value : "web";
}
async function recordFact(runtime: LightTickRuntime, request: HttpRequest, userId: string, event: LightTickServerEvent,
  dedupeKey: string, pageKey: string, metadata: Json = {}) {
  try { await runtime.analytics?.record({ userId, event, dedupeKey, pageKey, platform: analyticsPlatform(request), metadata }); }
  catch { /* Product writes must not fail when ordinary analytics is unavailable. */ }
}
function runData(row: LightTickAiRunRow) { return { id: row.id, kind: row.kind, scene: row.sceneKey, status: row.status,
  retryable: row.status === "failed", result_resource_id: row.resourceId, error_code: row.errorCode,
  result: row.status === "succeeded" ? row.output : undefined,
  created_at: row.createdAt, updated_at: row.updatedAt }; }
async function createRun(runtime: LightTickRuntime, owner: LightTickOwner, kind: string, sceneName: LightTickAiSceneName,
  resourceId: string | undefined, input: Json): Promise<LightTickAiRunRow> {
  const now = new Date().toISOString(); const scene = LIGHTTICK_AI_SCENES[sceneName];
  return await runtime.repository.saveAiRun({ ...owner, id: randomId("lighttick_run"), kind, status: "queued",
    resourceId, sceneKey: scene.key, promptVersion: scene.promptVersion, schemaVersion: scene.schemaVersion, attemptCount: 0,
    inputContext: input, usage: {}, createdAt: now, updatedAt: now });
}

export async function tryHandleLightTickPhase2Routes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (!request.path.startsWith(PREFIX)) return undefined;
  if (!enabled || !runtime) throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "LightTick is not enabled for this deployment.");
  const auth = await context.authenticateProductRequest(request, LIGHTTICK_APP_ID);
  const owner: LightTickOwner = { appId: LIGHTTICK_APP_ID, userId: auth.userId };
  const guest = runtime.guestIdentity ? await runtime.guestIdentity.getActive(auth.userId) : undefined;
  if (guest) throw new ApplicationError(403, "APP_SCOPE_FORBIDDEN", "Guest sessions cannot access this LightTick capability.");

  if (request.path === `${PREFIX}execution-facts` && request.method === "GET") {
    const from = request.query?.from?.trim() || undefined;
    const to = request.query?.to?.trim() || undefined;
    const { facts, feedback } = await runtime.feedback.evaluate(owner, from, to);
    return response(context, request, {
      window: facts.window,
      completed_count: facts.completedCount,
      average_deviation_minutes: Number(facts.averageDeviationMinutes.toFixed(1)),
      by_lineage: Object.fromEntries(Object.entries(facts.byLineage).map(([lineage, group]) => [lineage, {
        title: group.title, count: group.count, total_estimated_minutes: group.totalEstimatedMinutes,
        total_actual_minutes: group.totalActualMinutes, deviation_minutes: group.deviationMinutes }])),
      by_slot: Object.fromEntries(Object.entries(facts.bySlot).map(([slot, group]) => [Number(slot), {
        count: group.count, average_deviation_minutes: Number(group.averageDeviationMinutes.toFixed(1)) }])),
      consecutive_skips: facts.maxConsecutiveSkipsByLineage,
      feedback: feedback.map(item => ({ rule_id: item.ruleId, kind: item.kind, message: item.message,
        evidence_count: item.evidenceCount, data_range: item.dataRange, confident: item.confident })),
    });
  }
  if (request.path === `${PREFIX}coach-runs` && request.method === "POST") {
    const body = bodyOf(request); const scene = stringOf(body.scene, "scene");
    if (scene !== "chat") return undefined;
    const goalId = stringOf(body.goal_id, "goal_id"); await runtime.goals.get(owner, goalId);
    if (body.plan_id && !await runtime.repository.getPlan(owner, String(body.plan_id)))
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Plan was not found.");
    if (body.review_id && !(await runtime.repository.listReviews(owner)).some(item => item.id === body.review_id))
      throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Review was not found.");
    const message = stringOf(body.message, "message");
    if (message.length > 4000) throw new ApplicationError(400, "REQ_FIELD_INVALID", "message is too long.");
    const threadId = typeof body.thread_id === "string" && body.thread_id.trim() ? body.thread_id.trim().slice(0, 128) : goalId;
    const operationId = idempotencyKeyOf(request);
    const data = await idempotent(runtime, owner, request, "coach_reply", goalId, "chat", async () => {
      const timestamp = new Date().toISOString();
      const userMessage = await runtime.repository.saveChatMessage({ ...owner, id: randomId("lighttick_chat"),
        threadId, goalId, role: "user", content: message, createdAt: timestamp });
      const run = await createRun(runtime, owner, "coach_reply", "coach_chat", undefined,
        { goal_id: goalId, thread_id: threadId, plan_id: body.plan_id, task_id: body.task_id,
          review_id: body.review_id, message, coach_scene: "chat" });
      await runtime.jobs?.enqueueAiRun(owner, run.id, "coach_chat");
      return { ...runData(run), thread_id: threadId, message_id: userMessage.id };
    });
    await recordFact(runtime, request, auth.userId, "lighttick_coach_message_sent", operationId, "coach",
      { operation_id: operationId, goal_id: goalId, scene: "chat", result: "queued" });
    return response(context, request, data, 202);
  }
  if (request.path === `${PREFIX}chat/messages` && request.method === "GET") {
    const goalId = stringOf(request.query?.goal_id, "goal_id");
    await runtime.goals.get(owner, goalId);
    const threadId = typeof request.query?.thread_id === "string" && request.query.thread_id.trim()
      ? request.query.thread_id.trim() : goalId;
    const limit = request.query?.limit === undefined ? 50 : Number(request.query.limit);
    const messages = await runtime.repository.listChatMessages(owner, threadId, limit);
    return response(context, request, { thread_id: threadId, goal_id: goalId, items: messages.map(message => ({
      id: message.id, role: message.role, content: message.content, run_id: message.runId, created_at: message.createdAt })) });
  }
  if (request.path === `${PREFIX}chat/intents` && request.method === "GET") {
    return response(context, request, { intents: [
      { key: "less_this_week", label: "减少本周任务", message: "这周任务太多了，帮我减少一点" },
      { key: "explain_plan", label: "解释规划逻辑", message: "解释一下这周计划是怎么安排的" },
      { key: "adjust_pace", label: "调整学习节奏", message: "帮我调整一下学习节奏" },
      { key: "low_energy", label: "我最近效率低", message: "我最近效率很低，怎么办" },
      { key: "plan_b", label: "给我换个 Plan B", message: "给我一个更轻松的 Plan B" },
      { key: "task_meaning", label: "解释这个任务的意义", message: "解释一下这个任务对我目标的意义" },
    ] });
  }
  if (request.path === `${PREFIX}dna/insights` && request.method === "GET") {
    const goalId = request.query?.goal_id?.trim() || undefined;
    await runtime.dna.synchronize(owner);
    const insights = await runtime.dna.list(owner, goalId);
    return response(context, request, { items: insights.map(insight => dnaInsightData(insight)), next_cursor: null });
  }
  const dnaFeedbackMatch = request.path.match(/^\/api\/v1\/lighttick\/dna\/insights\/([^/]+)\/feedback$/);
  if (dnaFeedbackMatch && request.method === "POST") {
    const body = bodyOf(request); const action = stringOf(body.action, "action");
    if (!["confirm", "deny", "correct", "dismiss"].includes(action))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "action is invalid.");
    const insight = await runtime.dna.feedback(owner, dnaFeedbackMatch[1]!, action as any,
      typeof body.correction === "string" ? body.correction : undefined);
    await recordFact(runtime, request, auth.userId, "lighttick_dna_insight_feedback", `dna:${insight.id}:${action}`, "dna",
      { insight_id: insight.id, rule_id: insight.ruleId, action, status: insight.status,
        allowed_effects: insight.allowedEffects });
    return response(context, request, dnaInsightData(insight));
  }
  if (request.path === `${PREFIX}proposals/from-facts` && request.method === "POST") {
    const body = bodyOf(request); const goalId = stringOf(body.goal_id, "goal_id");
    const result = await runtime.proposals.proposeFromFacts(owner, goalId);
    const rendered = { suppressed: result.suppressed, items: result.proposals.map(proposal => ({
      id: proposal.id, plan_id: proposal.planId, status: proposal.status, reason: proposal.reason,
      diff: proposal.diff, impact: proposal.impact, expires_at: proposal.expiresAt,
      created_at: proposal.createdAt })) };
    if (result.suppressed) {
      await recordFact(runtime, request, auth.userId, "lighttick_proposal_suppressed", `facts:${goalId}`, "coach",
        { operation_id: request.requestId, goal_id: goalId, suppressed: result.suppressed });
    }
    return response(context, request, rendered);
  }
  const reviewActionMatch = request.path.match(/^\/api\/v1\/lighttick\/reviews\/([^/]+)\/actions$/);
  if (reviewActionMatch && request.method === "GET") {
    const result = await runtime.deepReview.actionable(owner, reviewActionMatch[1]!);
    return response(context, request, { review: reviewData(result.review), recommendations: result.recommendations,
      action_state: result.actionState });
  }
  if (reviewActionMatch && request.method === "POST") {
    const body = bodyOf(request); const action = stringOf(body.action, "action");
    const selectedIds = Array.isArray(body.recommendation_ids) ? body.recommendation_ids.filter(item => typeof item === "string") as string[] : [];
    const result = await runtime.deepReview.apply(owner, reviewActionMatch[1]!, action as any, selectedIds,
      typeof body.ignore_reason === "string" ? body.ignore_reason : undefined);
    await recordFact(runtime, request, auth.userId, "lighttick_review_action_applied", `review:${result.review.id}:${action}`, "review",
      { review_id: result.review.id, action, selected_count: result.selectedRecommendationIds.length,
        proposed_plan_id: result.proposedPlan?.id });
    return response(context, request, { review: reviewData(result.review), action: result.action,
      selected_recommendation_ids: result.selectedRecommendationIds, proposed_plan: result.proposedPlan,
      recommendations: result.recommendations });
  }
  if (request.path === `${PREFIX}today/rhythm-suggestion` && request.method === "GET") {
    const result = await runtime.rhythm.suggest(owner);
    if (result.suggestion) {
      await recordFact(runtime, request, auth.userId, "lighttick_rhythm_suggestion_shown", `rhythm:${result.suggestion.insightId}`,
        "today", { insight_id: result.suggestion.insightId, rule_id: result.suggestion.ruleId, task_id: result.suggestion.task.id });
    }
    return response(context, request, result);
  }
  if (request.path === `${PREFIX}today/rhythm-suggestion/feedback` && request.method === "POST") {
    const body = bodyOf(request); const action = stringOf(body.action, "action");
    const insightId = stringOf(body.insight_id, "insight_id");
    if (!["accept", "dismiss"].includes(action))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "action is invalid.");
    const insight = await runtime.rhythm.feedback(owner, insightId, action as "accept" | "dismiss");
    await recordFact(runtime, request, auth.userId, "lighttick_rhythm_suggestion_feedback", `rhythm:${insight.id}:${action}`,
      "today", { insight_id: insight.id, rule_id: insight.ruleId, action, status: insight.status });
    return response(context, request, { id: insight.id, rule_id: insight.ruleId, status: insight.status,
      user_feedback: insight.userFeedback, updated_at: insight.updatedAt });
  }
  return undefined;
}

function dnaInsightData(insight: any) {
  return { id: insight.id, rule_id: insight.ruleId, statement: insight.statement, kind: insight.kind,
    status: insight.status, evidence_count: insight.evidenceCount, data_range: insight.dataRange,
    confidence: insight.confidence, scope: insight.scope, allowed_effects: insight.allowedEffects,
    user_feedback: insight.userFeedback, created_at: insight.createdAt, expires_at: insight.expiresAt,
    updated_at: insight.updatedAt };
}

function reviewData(review: any) {
  return { id: review.id, goal_id: review.goalId, period: review.period, status: review.status,
    period_start: review.periodStart, period_end: review.periodEnd, facts: review.facts,
    insights: review.output?.insights ?? [], recommendations: review.output?.recommendations ?? [],
    data_sufficiency: review.dataSufficiency, action_state: review.output?.action_state,
    version: review.version, created_at: review.createdAt, updated_at: review.updatedAt };
}

function idempotencyKeyOf(request: HttpRequest): string {
  const key = request.headers["idempotency-key"] ?? request.headers["Idempotency-Key"];
  if (!key || key.length < 8 || key.length > 128)
    throw new ApplicationError(400, "REQ_FIELD_REQUIRED", "Idempotency-Key is required.");
  return key;
}
async function idempotent<T>(runtime: LightTickRuntime, owner: LightTickOwner, request: HttpRequest,
  entityType: string, entityId: string, action: string, execute: () => Promise<T>): Promise<T> {
  const key = idempotencyKeyOf(request);
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
