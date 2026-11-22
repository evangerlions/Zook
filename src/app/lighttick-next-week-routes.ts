import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";
import type { HttpRequest } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { sha256 } from "../shared/utils.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import { businessDateAt } from "../modules/lighttick/lighttick-today.service.ts";
import { createLightTickAiRun } from "../modules/lighttick/ai/lighttick-ai-run-record.ts";
import { buildLightTickPublicConfiguration } from "../modules/lighttick/lighttick-public-config.ts";
import { ManualPlanningService } from "../modules/lighttick/manual/manual-planning.service.ts";
import { boundedText, dateOnly, type ManualDraft } from "../modules/lighttick/manual/manual-planning.types.ts";
import { assertDailyCapacity } from "../modules/lighttick/goal-context/confirmed-conditions.ts";
import {
  assertNextWeekContextCurrent, loadNextWeekContext, nextWeekRange, NEXT_WEEK_EXCERPT_LIMIT,
  type NextWeekAdvice, type NextWeekContext,
} from "../modules/lighttick/next-week-advice.ts";

const kind = "next_week_advice";
const path = /^\/api\/v1\/lighttick\/goals\/([^/]+)\/next-week-advice(?:\/([^/]+)\/decision)?$/;

function invalid(message: string): never {
  throw new ApplicationError(400, "REQ_FIELD_INVALID", message);
}

function requireFields(value: Record<string, unknown>, fields: string[]) {
  if (Object.keys(value).some(key => !fields.includes(key))) invalid("Unexpected next-week advice field.");
}

function rangeOf(start: unknown, end: unknown, today: string, nextWeekStart: string) {
  if (!dateOnly(start) || !dateOnly(end) || start > end || start > today || end >= nextWeekStart ||
    Date.parse(end) - Date.parse(start) > 6 * 86400000)
    return invalid("Choose up to seven review dates, starting no later than today.");
  return { period_start: start, period_end: end };
}

function parseSource(value: unknown) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid("Select a saved reflection excerpt.");
  const source = value as Record<string, unknown>;
  requireFields(source, ["reflection_id", "reflection_version", "excerpt"]);
  if (!boundedText(source.reflection_id, 128, true) || typeof source.reflection_version !== "number" ||
    !Number.isSafeInteger(source.reflection_version) || source.reflection_version < 1 ||
    !boundedText(source.excerpt, NEXT_WEEK_EXCERPT_LIMIT, true))
    return invalid(`Select a valid reflection revision and up to ${NEXT_WEEK_EXCERPT_LIMIT} characters for this analysis.`);
  return { reflection_id: source.reflection_id, reflection_version: source.reflection_version, excerpt: source.excerpt };
}

type Outcome = NextWeekAdvice & { resolution?: { decision: "kept" | "applied"; plan_id?: string } };
const domainContext = (run: LightTickAiRunRow) => run.inputContext.next_week as NextWeekContext;
const outputFor = (run: LightTickAiRunRow) => run.output as Outcome | undefined;

function adviceData(run: LightTickAiRunRow, stale = false) {
  const output = outputFor(run);
  return {
    id: run.id, status: run.status, facts: domainContext(run).facts,
    ...(output ? { output: { decision: output.decision, summary: output.summary, tasks: output.tasks } } : {}),
    ...(output?.resolution ? { decision: output.resolution.decision, plan_id: output.resolution.plan_id } : {}),
    ...(run.errorCode ? { error_code: run.errorCode } : {}),
    ...(stale ? { stale: true } : {}),
  };
}

function notFound(): never {
  throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Next-week advice was not found for this goal.");
}

async function applyAdvice(runtime: LightTickRuntime, owner: LightTickOwner, run: LightTickAiRunRow,
  body: Record<string, unknown>, clock: () => Date, assertActive: () => Promise<void>) {
  const output = outputFor(run);
  if (run.status !== "succeeded" || !output)
    throw new ApplicationError(409, "LIGHTTICK_NEXT_WEEK_NOT_READY", "Review the completed advice before deciding.");
  if (output.resolution) throw new ApplicationError(409, "LIGHTTICK_NEXT_WEEK_ALREADY_DECIDED", "This advice already has a decision.");
  const now = clock();
  if (body.decision === "keep") {
    requireFields(body, ["decision"]);
    return await runtime.repository.saveAiRun({ ...run, updatedAt: now.toISOString(),
      output: { ...output, resolution: { decision: "kept" } } });
  }
  requireFields(body, ["decision", "tasks"]);
  if (body.decision !== "apply" || output.decision !== "adjust" || !Array.isArray(body.tasks) ||
    !body.tasks.length || body.tasks.length > output.tasks.length) return invalid("Review at least one suggested action before applying.");
  if (process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED === "0" || process.env.LIGHTTICK_NATIVE_CONTINUATION_ENABLED === "0")
    throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "New planning confirmation is disabled; the suggestion remains readable.");
  const advice = domainContext(run);
  const currentAdvice = await assertNextWeekContextCurrent(runtime.repository, owner, advice, now);
  const profile = await runtime.repository.getProfile(owner);
  const timezone = profile?.timezone ?? "UTC";
  const today = businessDateAt(now, timezone);
  const goal = await runtime.repository.getGoal(owner, advice.goal_id);
  if (!goal || goal.status !== "active") return notFound();
  const byId = new Map(output.tasks.map(task => [task.id, task]));
  const selectedIds = new Set<string>();
  const draft: ManualDraft = {
    goal_id: goal.id, title: "下一周安排",
    completion_criteria: "",
    period_start: advice.next_period_start, period_end: advice.next_period_end,
    replace_tasks: [],
    tasks: body.tasks.map((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return invalid("Review each next-week action.");
      const item = entry as Record<string, unknown>;
      requireFields(item, ["id", "title", "scheduled_for", "estimated_minutes", "completion_criteria"]);
      const original = typeof item.id === "string" ? byId.get(item.id) : undefined;
      if (!original || selectedIds.has(original.id) || !boundedText(item.title, 160, true) || !dateOnly(item.scheduled_for) ||
        item.scheduled_for < today || item.scheduled_for < advice.next_period_start || item.scheduled_for > advice.next_period_end ||
        typeof item.estimated_minutes !== "number" || !Number.isInteger(item.estimated_minutes) ||
        item.estimated_minutes < 1 || item.estimated_minutes > 1440 || !boundedText(item.completion_criteria, 1000, true))
        return invalid("Choose a unique action, a date in the reviewed week and valid remaining effort.");
      if (goal.targetDate && item.scheduled_for > goal.targetDate.slice(0, 10))
        throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Choose a date within the goal's confirmed deadline.");
      selectedIds.add(original.id);
      return { id: original.id, title: item.title.trim(), scheduled_for: item.scheduled_for,
        estimated_minutes: item.estimated_minutes, completion_criteria: item.completion_criteria.trim(),
        guidance: "", ...(original.source_task_id ? { source_task_id: original.source_task_id } : {}) };
    }),
  };
  for (const action of draft.tasks) {
    if (!action.source_task_id) continue;
    const source = currentAdvice.carry_sources.find(item => item.id === action.source_task_id);
    if (!source) throw new ApplicationError(409, "LIGHTTICK_NEXT_WEEK_STALE", "The source action must be reviewed again.");
    if (source.remaining_estimated_minutes !== null && action.estimated_minutes! < source.remaining_estimated_minutes)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Update the original remaining estimate before transferring less effort.");
    draft.replace_tasks!.push({ id: source.id, version: source.version });
  }
  const weeklyLimit = currentAdvice.availability.weekly_minutes;
  if (weeklyLimit !== null) {
    const plans = await runtime.repository.listPlans(owner, goal.id);
    const active = new Set(plans.filter(plan => plan.status === "active").map(plan => plan.id));
    const tasks = (await runtime.repository.listTasks(owner)).filter(task => active.has(task.planId) || task.status === "completed");
    const daily = assertDailyCapacity(goal, draft.period_start, draft.period_end, draft.tasks, tasks,
      new Set(draft.replace_tasks!.map(task => task.id)), timezone);
    if (daily.some(day => day.unknown_count > 0) || daily.reduce((total, day) => total + day.known_minutes, 0) > weeklyLimit)
      throw new ApplicationError(422, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Review unestimated work and the confirmed weekly budget before applying.");
  }
  const service = new ManualPlanningService(runtime.repository, clock, assertActive);
  const identity = sha256(run.id);
  const preview = await service.create(owner, "next-week-draft:" + identity, draft, { next_week_advice_run_id: run.id });
  const plan = await service.confirm(owner, preview.id, "next-week-confirm:" + identity,
    { base_version: preview.version, goal_base_version: goal.version });
  return await runtime.repository.saveAiRun({ ...run, updatedAt: now.toISOString(),
    output: { ...output, resolution: { decision: "applied", plan_id: plan.id } } });
}

export async function handleLightTickNextWeekAdvice(context: BackendRouteContext, runtime: LightTickRuntime,
  owner: LightTickOwner, request: HttpRequest, assertActive: () => Promise<void>) {
  const match = path.exec(request.path);
  if (!match) return undefined;
  if (!["GET", "POST"].includes(request.method) || (match[2] && request.method !== "POST"))
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
  const goalId = match[1]!;
  const getGoal = () => runtime.repository.getGoal(owner, goalId);
  const goal = await getGoal();
  if (!goal) return notFound();
  const clock = () => runtime.today.now();
  const privateResponse = (data: unknown, status?: number) => {
    const result = response(context, request, data, status);
    return { ...result, headers: { ...result.headers, "Cache-Control": "no-store" } };
  };
  const getAvailability = async () => Boolean(runtime.planningEnabled && runtime.jobs &&
    buildLightTickPublicConfiguration(true, await context.database.findAppConfig("lighttick", "admin.delivery_config")).features.ai_coach);
  if (match[2]) {
    const runId = match[2];
    const body = bodyOf(request);
    const result = await idempotent(runtime, owner, request, kind, runId, "decide", async () => {
      await assertActive();
      const run = await runtime.repository.getAiRun(owner, runId);
      if (run?.kind !== kind || run.resourceId !== goalId) return notFound();
      return adviceData(await applyAdvice(runtime, owner, run, body, clock, assertActive));
    });
    return privateResponse(result);
  }
  const now = clock();
  const timezone = (await runtime.repository.getProfile(owner))?.timezone ?? "UTC";
  const today = businessDateAt(now, timezone);
  const next = nextWeekRange(now, timezone);
  const body = request.method === "GET" ? request.query ?? {} : bodyOf(request);
  if (request.method === "POST") requireFields(body, ["period_start", "period_end", "source"]);
  const dates = rangeOf(body.period_start, body.period_end, today, next.start);
  const latest = () => runtime.repository.getLatestNextWeekAdvice(owner, goalId, dates.period_start, dates.period_end);
  let run: LightTickAiRunRow | undefined;
  let enabled = await getAvailability() && goal.status === "active";
  if (request.method === "POST") {
    const source = parseSource(body.source);
    const receipt = await idempotent(runtime, owner, request, kind, goalId, "generate", async () => {
      await assertActive();
      const current = await getGoal();
      if (current?.status !== "active" || !await getAvailability())
        throw new ApplicationError(503, "LIGHTTICK_AI_UNAVAILABLE", "AI advice is unavailable. Manual reflection and planning are available.");
      const inFlight = await latest();
      if (inFlight && (["queued", "running"].includes(inFlight.status) || outputFor(inFlight)?.resolution))
        return { id: inFlight.id };
      const nextWeek = await loadNextWeekContext(runtime.repository, owner, goalId,
        { ...dates, next_period_start: next.start, next_period_end: next.end, source }, clock());
      if (inFlight?.status === "succeeded" && nextWeek.fingerprint === domainContext(inFlight).fingerprint)
        return { id: inFlight.id };
      const queued = await createLightTickAiRun(runtime.repository, owner, kind, kind, goalId,
        { next_week: nextWeek }, new Date().toISOString());
      return { id: queued.id };
    });
    run = await runtime.repository.getAiRun(owner, receipt.id);
    enabled = await getAvailability() && (await getGoal())?.status === "active";
    if (run?.status === "queued" && enabled) await runtime.jobs!.enqueueAiRun(owner, run.id, kind);
  } else {
    run = await latest();
  }
  const captured = run ? domainContext(run) : undefined;
  let stale = false;
  if (run?.status === "succeeded" && captured && !outputFor(run)?.resolution) {
    try {
      await assertNextWeekContextCurrent(runtime.repository, owner, captured, now);
      stale = captured.next_period_end < today;
    }
    catch (error) {
      if (!(error instanceof ApplicationError) || error.statusCode >= 500) throw error;
      stale = true;
    }
  }
  return privateResponse({ enabled, ...dates,
    next_period_start: captured?.next_period_start ?? next.start,
    next_period_end: captured?.next_period_end ?? next.end,
    ...(run ? { latest: adviceData(run, stale) } : {}),
  }, request.method === "POST" && run?.status === "queued" ? 202 : 200);
}
