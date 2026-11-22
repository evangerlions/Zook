import { GoalSubjectsService } from "../modules/lighttick/planning/goal-subjects.service.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

const route = /^\/api\/v1\/lighttick\/goals\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})\/subjects(?:\/([A-Za-z0-9_-]{1,128})\/outcomes)?$/;

export async function handleGoalSubjectRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const matched = route.exec(request.path);
  if (!matched) return undefined;
  const goalId = matched[1]!, subjectId = matched[2];
  const service = new GoalSubjectsService(runtime.repository, () => runtime.today.now());
  let data;
  if (!subjectId && request.method === "GET") {
    data = await service.get(owner, goalId);
  } else if (!subjectId && request.method === "PATCH") {
    data = await idempotent(runtime, owner, request, "goal", goalId, "subjects_update", async () => {
      await assertActive();
      return service.update(owner, goalId, bodyOf(request));
    });
  } else if (subjectId && request.method === "POST") {
    data = await idempotent(runtime, owner, request, "goal", goalId, "subject_outcome:" + subjectId, async () => {
      await assertActive();
      return service.recordOutcome(owner, goalId, subjectId, bodyOf(request));
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
