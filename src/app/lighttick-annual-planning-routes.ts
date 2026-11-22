import { AnnualPlanningService } from "../modules/lighttick/planning/annual-planning.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

const path = "/api/v1/lighttick/planning-year";

export async function handleAnnualPlanningRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  if (request.path !== path && request.path !== path + "/confirm") return undefined;
  const service = new AnnualPlanningService(runtime.repository, () => runtime.today.now());
  let data;
  if (request.path === path && request.method === "GET") {
    data = await service.get(owner, request.query?.year);
  } else if (request.path === path + "/confirm" && request.method === "POST") {
    data = await idempotent(runtime, owner, request, "planning_year", owner.userId, "confirm", async () => {
      await assertActive();
      return service.confirm(owner, bodyOf(request));
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.");
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
