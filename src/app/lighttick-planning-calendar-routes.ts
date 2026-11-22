import { readPlanCapacityPreview } from "../modules/lighttick/planning/plan-capacity-preview.ts";
import { readPlanningAgenda } from "../modules/lighttick/planning/planning-agenda.ts";
import { readWeeklyPlanningCapacity, saveWeeklyPlanningCapacity } from "../modules/lighttick/planning/weekly-capacity.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";
import { handleGoalRoadmapRequest } from "./lighttick-goal-roadmap-routes.ts";
import { handleGoalSubjectRequest } from "./lighttick-goal-subject-routes.ts";
import { handleAnnualPlanningRequest } from "./lighttick-annual-planning-routes.ts";

export async function handlePlanningCalendarRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const agenda = request.path === "/api/v1/lighttick/planning-agenda";
  const preview = request.path === "/api/v1/lighttick/planning-capacity/preview";
  if (!agenda && !preview && request.path !== "/api/v1/lighttick/planning-capacity")
    return await handleAnnualPlanningRequest(context, runtime, owner, request, assertActive) ??
      await handleGoalRoadmapRequest(context, runtime, owner, request, assertActive) ??
      await handleGoalSubjectRequest(context, runtime, owner, request, assertActive);
  const now = runtime.today.now();
  let data: unknown;
  if (preview) {
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
