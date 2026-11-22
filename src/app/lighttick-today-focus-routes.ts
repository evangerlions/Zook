import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { TodayFocusService } from "../modules/lighttick/today-focus/today-focus.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";

const PREFIX = "/api/v1/lighttick/today/focus";

export async function handleTodayFocusRequest(
  runtime: LightTickRuntime,
  owner: LightTickOwner,
  request: HttpRequest,
  assertActive: () => Promise<void>,
) {
  if (request.path !== PREFIX && !request.path.startsWith(PREFIX + "/")) return;
  const service = new TodayFocusService(runtime.repository, runtime.today);
  if (request.path === PREFIX && request.method === "GET") return service.current(owner);
  if (request.path === PREFIX && request.method === "PUT") {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) ||
        Buffer.byteLength(JSON.stringify(body)) > 10_000) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "焦点请求无效。");
    }
    return service.select(owner, body as Record<string, unknown>, assertActive);
  }
  const receipt = /^\/requests\/([a-zA-Z0-9_-]{8,160})$/.exec(request.path.slice(PREFIX.length));
  if (receipt && request.method === "GET") return service.byRequest(owner, receipt[1]);
  throw new ApplicationError(405, "VALIDATION_ERROR", "Unsupported today focus method or path.");
}
