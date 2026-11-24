import { applyConditionTaskReview, previewConditionTaskReview } from "../modules/lighttick/goal-context/condition-task-review.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { continuationGoalData } from "./lighttick-continuation-routes.ts";
import { bodyOf, idempotencyKeyOf, response } from "./lighttick-v1-http.ts";

export async function handleConditionTaskReviewRequest(context: BackendRouteContext, runtime: LightTickRuntime,
  owner: LightTickOwner, request: HttpRequest, assertActive: () => Promise<void>) {
  const match = /^\/api\/v1\/lighttick\/goals\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})\/conditions\/(preview|apply)$/.exec(request.path);
  if (!match) return;
  if (request.method !== "POST")
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.", undefined, { Allow: "POST" });
  const goalId = match[1]!, clock = () => runtime.today.now(), input = bodyOf(request);
  let data: unknown;
  if (match[2] === "preview") {
    data = await previewConditionTaskReview(runtime.repository, owner, goalId, clock, input);
  } else {
    const key = idempotencyKeyOf(request);
    if (process.env.LIGHTTICK_NATIVE_CONTINUATION_ENABLED === "0" && !await runtime.repository.getOperation(owner, key))
      throw new ApplicationError(503, "LIGHTTICK_APP_DISABLED", "New continuation writes are unavailable; accepted requests remain available.");
    const result = await applyConditionTaskReview(runtime.repository, owner, goalId, clock, key, input, assertActive);
    data = { ...result, goal: continuationGoalData(result.goal) };
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
