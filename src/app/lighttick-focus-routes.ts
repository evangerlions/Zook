import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { FocusService } from "../modules/lighttick/focus/focus.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest } from "../shared/types.ts";

const PREFIX = "/api/v1/lighttick/focus";

export async function handleFocusRequest(
  runtime: LightTickRuntime,
  owner: LightTickOwner,
  request: HttpRequest,
  authorize: () => Promise<void>,
) {
  if (request.path !== PREFIX && !request.path.startsWith(PREFIX + "/")) return;
  const path = request.path.slice(PREFIX.length);
  const service = new FocusService(runtime.repository, runtime.focus.clock, authorize);
  const body = request.body ?? {};
  if (!body || typeof body !== "object" || Array.isArray(body) || Buffer.byteLength(JSON.stringify(body)) > 10_000) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "计时请求无效。");
  }
  const input = body as Record<string, unknown>;
  if (path === "/current" && request.method === "GET") return { data: await service.current(owner) };
  if (path === "/preferences" && request.method === "PUT") return { data: await service.preferences(owner, input) };
  if (path === "/sessions" && request.method === "GET") return { data: await service.history(owner, request.query ?? {}) };
  if (path === "/sessions" && request.method === "POST") return { data: await service.start(owner, input), statusCode: 201 };
  const receipt = /^\/requests\/([a-zA-Z0-9_-]{8,160})$/.exec(path);
  if (receipt && request.method === "GET") return { data: await service.byRequest(owner, receipt[1]) };

  const session = /^\/sessions\/(focus_session_[a-f0-9]{40})(\/commands)?$/.exec(path);
  if (session && !session[2] && request.method === "GET") return { data: await service.get(owner, session[1]) };
  if (session && session[2] && request.method === "POST") return { data: await service.command(owner, session[1], input) };
  throw new ApplicationError(405, "VALIDATION_ERROR", "计时路径或方法无效。");
}
