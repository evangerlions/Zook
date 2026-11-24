import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { getTaskPrerequisite, setTaskPrerequisite } from "../modules/lighttick/planning/task-prerequisite.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotent, response } from "./lighttick-v1-http.ts";

export async function handleTaskPrerequisiteRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, assertActive: () => Promise<void>) {
  const id = /^\/api\/v1\/lighttick\/tasks\/([A-Za-z0-9][A-Za-z0-9_-]{7,127})\/prerequisite$/.exec(request.path)?.[1];
  if (!id) return undefined;
  let data: Awaited<ReturnType<typeof getTaskPrerequisite>>;
  if (request.method === "GET") {
    data = await getTaskPrerequisite(runtime.repository, owner, id);
  } else if (request.method === "PUT") {
    data = await idempotent(runtime, owner, request, "task", id, "set_prerequisite", async () => {
      await assertActive();
      return setTaskPrerequisite(runtime.repository, owner, id, bodyOf(request), runtime.today.now());
    });
  } else {
    throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "Method is not supported.", undefined, { Allow: "GET, PUT" });
  }
  const result = response(context, request, data);
  result.headers = { ...result.headers, "Cache-Control": "no-store" };
  return result;
}
