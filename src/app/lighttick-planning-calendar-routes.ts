import { readPlanningAgenda } from "../modules/lighttick/planning/planning-agenda.ts";
import { readWeeklyPlanningCapacity, saveWeeklyPlanningCapacity } from "../modules/lighttick/planning/weekly-capacity.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";
import { handleGoalRoadmapRequest } from "./lighttick-goal-roadmap-routes.ts";

export async function handlePlanningCalendarRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const agenda = request.path === "/api/v1/lighttick/planning-agenda";
  if (!agenda && request.path !== "/api/v1/lighttick/planning-capacity")
    return handleGoalRoadmapRequest(context, runtime, owner, request, assertActive);
  const now = runtime.today.now();
  let data: unknown;
  if (agenda && request.method === "GET") {
    data = await readPlanningAgenda(runtime.repository, owner, now, request.query?.starts_on, request.query?.ends_on);
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
