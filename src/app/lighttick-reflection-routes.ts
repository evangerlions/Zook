import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { LightTickReflectionService, reflectionData } from "../modules/lighttick/lighttick-reflection.service.ts";

// Called only after the shared LightTick authentication and guest capability checks.
export async function handleReflectionRequest(repository: LightTickRepository, owner: LightTickOwner, request: HttpRequest) {
  const service = new LightTickReflectionService(repository);
  if (request.path === "/api/v1/lighttick/reflections" && request.method === "GET") {
    const goalId = request.query?.goal_id;
    if (typeof goalId !== "string" || !goalId.trim())
      throw new ApplicationError(400, "REQ_FIELD_REQUIRED", "goal_id is required.");
    return { items: (await service.list(owner, goalId)).map(reflectionData) };
  }
  const match = request.path.match(/^\/api\/v1\/lighttick\/reflections\/([a-zA-Z0-9_-]+)$/);
  if (!match || request.method !== "PUT") return undefined;
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body))
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Request body must be an object.");
  const body = request.body as Record<string, unknown>;
  if (Object.keys(body).some(k => !["goal_id", "plan_id", "period_start", "period_end", "content", "next_action", "base_version"].includes(k)))
    throw new ApplicationError(400, "REQ_FIELD_INVALID", "Unknown reflection field.");
  return reflectionData(await service.save(owner, match[1]!, body as Parameters<LightTickReflectionService["save"]>[2]));
}
