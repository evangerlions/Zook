import { validateManualRequest } from "../modules/lighttick/manual/manual-contracts.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { ManualPlanningService } from "../modules/lighttick/manual/manual-planning.service.ts";
import { LocalAdoptionService } from "../modules/lighttick/manual/local-adoption.service.ts";
import type { ManualDraft } from "../modules/lighttick/manual/manual-planning.types.ts";
import type { LocalAdoptionInput } from "../modules/lighttick/manual/local-adoption.types.ts";
const prefix = "/api/v1/lighttick/";
/** Called only after product authentication and the registered-account route gate. */
export async function handleManualRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
  assertActive: () => Promise<void> = async () => {},
) {
  const relative = request.path.slice(prefix.length),
    match = /^manual-plans\/([a-zA-Z0-9_-]{1,128})(\/confirm)?$/.exec(relative);
  if (!match && !["manual-plans", "local-adoptions"].includes(relative))
    return undefined;
  const service = new ManualPlanningService(
    repository,
    () => new Date(),
    assertActive,
  );
  if (request.method === "GET" && relative === "manual-plans")
    return { items: await service.list(owner) };
  if (request.method === "GET" && match && !match[2])
    return service.get(owner, match[1]);
  if (
    !request.body ||
    typeof request.body !== "object" ||
    Array.isArray(request.body)
  )
    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      "A request object is required.",
    );
  const key =
    request.headers["idempotency-key"] ??
    request.headers["Idempotency-Key"] ??
    "";
  if (
    process.env.LIGHTTICK_MANUAL_PLANNING_ENABLED === "0" &&
    !(await repository.getOperation(owner, key))
  )
    throw new ApplicationError(
      503,
      "LIGHTTICK_APP_DISABLED",
      "New manual cloud writes are unavailable; saved plans and request receipts remain readable.",
    );
  if (request.method === "POST" && relative === "manual-plans") {
    validateManualRequest("create", request.body);
    return service.create(owner, key, request.body as unknown as ManualDraft);
  }
  if (request.method === "PATCH" && match && !match[2]) {
    validateManualRequest("edit", request.body);
    return service.update(
      owner,
      match[1],
      key,
      request.body as unknown as ManualDraft & { base_version: number },
    );
  }
  if (request.method === "POST" && match?.[2]) {
    validateManualRequest("confirm", request.body);
    return service.confirm(
      owner,
      match[1],
      key,
      request.body as { base_version: number; goal_base_version: number },
    );
  }
  if (request.method === "POST" && relative === "local-adoptions") {
    validateManualRequest("adopt", request.body);
    return new LocalAdoptionService(
      repository,
      () => new Date(),
      assertActive,
    ).adopt(owner, key, request.body as unknown as LocalAdoptionInput);
  }
  throw new ApplicationError(
    404,
    "LIGHTTICK_RESOURCE_NOT_FOUND",
    "Manual planning route was not found.",
  );
}
