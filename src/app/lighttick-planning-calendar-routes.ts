import { readPlanCapacityPreview } from "../modules/lighttick/planning/plan-capacity-preview.ts";
import { plannedRestDate, readPlannedRest, savePlannedRest } from "../modules/lighttick/planning/planned-rest.ts";
import { readPlanningAvailability, savePlanningAvailability } from "../modules/lighttick/planning/planning-availability.ts";
import { readPlanningAgenda } from "../modules/lighttick/planning/planning-agenda.ts";
import { readWeeklyPlanningCapacity, saveWeeklyPlanningCapacity } from "../modules/lighttick/planning/weekly-capacity.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";
import { handleConditionTaskReviewRequest } from "./lighttick-condition-task-review-routes.ts";
import { handleStageOutcomeEvidenceRequest } from "./lighttick-stage-outcome-evidence-routes.ts";
import { handleGoalRoadmapRequest } from "./lighttick-goal-roadmap-routes.ts";
import { handleGoalSubjectRequest } from "./lighttick-goal-subject-routes.ts";
import { handleAnnualPlanningRequest } from "./lighttick-annual-planning-routes.ts";

export async function handlePlanningCalendarRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const agenda = request.path === "/api/v1/lighttick/planning-agenda";
  const preview = request.path === "/api/v1/lighttick/planning-capacity/preview";
  const availability = request.path === "/api/v1/lighttick/planning-calendar/availability";
  const rest = request.path === "/api/v1/lighttick/planning-calendar/rest";
  if (!agenda && !preview && !rest && !availability && request.path !== "/api/v1/lighttick/planning-capacity")
    return await handleAnnualPlanningRequest(context, runtime, owner, request, assertActive) ??
      await handleGoalRoadmapRequest(context, runtime, owner, request, assertActive) ??
      await handleStageOutcomeEvidenceRequest(context, runtime, owner, request, assertActive) ??
      await handleConditionTaskReviewRequest(context, runtime, owner, request, assertActive) ??
      await handleGoalSubjectRequest(context, runtime, owner, request, assertActive);
  const now = runtime.today.now();
  let data: unknown;
  if (availability) {
    if (request.method === "GET") {
      data = await readPlanningAvailability(runtime.repository, owner);
    } else if (request.method === "PUT") {
      data = await idempotent(runtime, owner, request, "planning_availability", owner.userId, "update", async () => {
        await assertActive();
        return savePlanningAvailability(runtime.repository, owner, bodyOf(request));
      });
    } else {
      throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.", undefined, { Allow: "GET, PUT" });
    }
  } else if (rest) {
    if (request.method === "GET") {
      data = await readPlannedRest(runtime.repository, owner, now, plannedRestDate(request.query?.date));
    } else if (request.method === "PUT") {
      const input = bodyOf(request);
      const date = plannedRestDate(input.date);
      data = await idempotent(runtime, owner, request, "planned_rest", date, "update", async () => {
        await assertActive();
        return savePlannedRest(runtime.repository, owner, now, input);
      });
    } else {
      throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.", undefined, { Allow: "GET, PUT" });
    }
  } else if (preview) {
    if (request.method !== "GET")
      throw new ApplicationError(405, "VALIDATION_ERROR", "Method is not supported.", undefined, { Allow: "GET" });
    data = await readPlanCapacityPreview(runtime.repository, owner, now, request.query?.plan_id, request.query?.plan_version);
  } else if (agenda && request.method === "GET") {
    data = await readPlanningAgenda(runtime.repository, owner, now, request.query ?? {});
  } else if (!agenda && request.method === "GET") {
    data = await readWeeklyPlanningCapacity(runtime.repository, owner, now, request.query?.date);
  } else if (!agenda && request.method === "PATCH") {
    data = await idempotent(runtime, owner, request, "planning_capacity", owner.userId, "update", async () => {
      await assertActive();
      return saveWeeklyPlanningCapacity(runtime.repository, owner, bodyOf(request), now);
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
