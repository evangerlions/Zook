import { GoalRoadmapService } from "../modules/lighttick/planning/goal-roadmap.ts";
import { GoalStageArchiveService } from "../modules/lighttick/planning/goal-stage-archive.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

const route = /^\/api\/v1\/lighttick\/goals\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})\/roadmap(?:\/stages\/([A-Za-z0-9_-]{1,128})\/(outcome|archive))?$/;

export async function handleGoalRoadmapRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const matched = route.exec(request.path);
  if (!matched) return undefined;
  const goalId = matched[1]!, stageId = matched[2], action = matched[3];
  const service = new GoalRoadmapService(runtime.repository, () => runtime.today.now());
  let data;
  if (!stageId && request.method === "GET") {
    data = await service.get(owner, goalId);
  } else if (!stageId && request.method === "PATCH") {
    data = await idempotent(runtime, owner, request, "goal", goalId, "roadmap_update", async () => {
      await assertActive();
      return service.update(owner, goalId, bodyOf(request));
    });
  } else if (stageId && action === "archive" && request.method === "GET") {
    // Read-only aggregation: no assertActive, so paused and ended goal roadmaps stay readable.
    data = await new GoalStageArchiveService(runtime.repository, () => runtime.today.now()).get(owner, goalId, stageId);
  } else if (stageId && action === "outcome" && request.method === "POST") {
    data = await idempotent(runtime, owner, request, "goal", goalId, "roadmap_outcome:" + stageId, async () => {
      await assertActive();
      return service.recordOutcome(owner, goalId, stageId, bodyOf(request));
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
