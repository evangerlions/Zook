import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import { BehaviorService } from "../modules/lighttick/behavior/behavior.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";

const PREFIX = "/api/v1/lighttick/behavior-applications";

export async function handleBehaviorJournalRequest(
  repository: LightTickRepository,
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  if (request.path !== PREFIX && !request.path.startsWith(PREFIX + "/")) return;
  const path = request.path.slice(PREFIX.length);
  const service = new BehaviorService(repository, undefined, authorize);
  if (request.method === "GET") {
    if (!path) return service.list(owner, request.query ?? {});
    if (path === "/catalog") return service.catalog(owner);
    if (path === "/concepts") return service.concepts(owner, request.query ?? {});
    const receipt = /^\/requests\/by-key\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
    if (receipt) return service.receipt(owner, receipt[1]);
    if (/^\/application-[a-zA-Z0-9-]{1,100}$/.test(path)) return service.get(owner, path.slice(1));
  }

  const body = request.body ?? {};
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 16_000) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "应用记录请求无效。");
  }
  const entry = /^\/(application-[a-zA-Z0-9-]{1,100})(\/archive)?$/.exec(path);
  const key = getHeader(request.headers, "idempotency-key") ?? "";
  const input = body as Record<string, unknown>;
  if (entry && !entry[2] && request.method === "PUT") return service.save(owner, entry[1], input, key);
  if (entry && entry[2] && request.method === "POST") return service.archive(owner, entry[1], input, key);
  throw new ApplicationError(405, "VALIDATION_ERROR", "不支持的应用记录操作。");
}
