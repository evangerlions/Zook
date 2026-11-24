import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickStarterPreviewRequest } from "../generated/openapi/public-contracts.generated.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import { bodyOf, idempotent, idempotencyKeyOf, recordFact, response, stringOf } from "./lighttick-v1-http.ts";
import { goalData, taskData, variantsData } from "./lighttick-route-mappers.ts";

const STARTER_PATH = "/api/v1/lighttick/onboarding/starter";

function starterInput(body: Record<string, unknown>): LightTickStarterPreviewRequest {
  if (body.goal_id === undefined) {
    return { wish: stringOf(body.wish, "wish"), timezone: stringOf(body.timezone, "timezone") };
  }
  if (typeof body.goal_id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(body.goal_id))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Choose a valid goal for this first action.");
  const wish = body.wish === undefined ? undefined : stringOf(body.wish, "wish");
  if (wish && wish.length > 500) throw new ApplicationError(400, "REQ_FIELD_INVALID", "Wish must be at most 500 characters.");
  return { goal_id: body.goal_id, timezone: stringOf(body.timezone, "timezone"), ...(wish ? { wish } : {}) };
}

export async function handleStarterRequest(
  context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner, request: HttpRequest,
) {
  const preview = request.path === STARTER_PATH + "-preview";
  if (request.method !== "POST" || (!preview && request.path !== STARTER_PATH)) return undefined;
  const body = bodyOf(request);
  if (preview) {
    if (Object.keys(body).some(key => !["wish", "timezone", "goal_id"].includes(key)))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Starter preview accepts a wish or goal and a timezone.");
    const data = await runtime.progressive.previewStarter(owner, starterInput(body));
    const result = response(context, request, data);
    result.headers = { ...result.headers, "Cache-Control": "no-store" };
    return result;
  }
  const operationId = idempotencyKeyOf(request);
  const data = await idempotent(runtime, owner, request, "profile", owner.userId, "progressive_starter", async () => {
    const result = await runtime.progressive.createStarter(owner, {
      ...starterInput(body),
      locale: body.locale as string | undefined, previewRevision: body.preview_revision,
    });
    return {
      source: result.source, wish: result.wish, assumption: result.assumption, goal: goalData(result.goal),
      recommended: taskData(result.recommended), alternatives: result.alternatives.map(item => ({
        candidate_id: item.candidateId, title: item.title, assumption: item.assumption, variants: variantsData(item.variants),
      })),
    };
  });
  await recordFact(runtime, request, owner.userId, "lighttick_wish_submitted", operationId, "onboarding",
    { operation_id: operationId, resource_id: data.goal.id, source: data.source });
  await recordFact(runtime, request, owner.userId, "lighttick_starter_shown", operationId, "onboarding",
    { operation_id: operationId, resource_id: data.recommended.id, source: data.source });
  return response(context, request, data, 201);
}
