import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import { LocalGenerationService, localScene } from "../modules/lighttick/personal-model/local-generation.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { bodyOf, idempotencyKeyOf, response } from "./lighttick-v1-http.ts";

export async function handleLocalGenerationRequest(context: BackendRouteContext, runtime: LightTickRuntime, owner: LightTickOwner,
  request: HttpRequest, authorize: () => Promise<void>): Promise<HttpResponse<unknown> | undefined> {
  const scene = /^\/api\/v1\/lighttick\/ai\/scenes\/([a-z_]+)\/contract$/.exec(request.path);
  const attempt = /^\/api\/v1\/lighttick\/ai\/local-generations(?:\/(?:receipts\/([a-zA-Z0-9_-]{8,128})|(localgen-[a-f0-9]{40})(?:\/(result|cancel))?))?$/.exec(request.path);
  if (!scene && !attempt) return;
  const service = new LocalGenerationService(runtime, authorize);
  if (scene && request.method === "GET") {
    const contract = await service.contract(owner, localScene(scene[1]));
    const etag = '"' + contract.rules_digest + '"';
    const headers = { ETag: etag, "Cache-Control": "private, no-cache", Vary: "Authorization, Origin" };
    const matches = getHeader(request.headers, "if-none-match")?.split(",").map(tag => tag.trim().replace(/^W\//, ""));
    if (matches?.includes(etag) || matches?.includes("*")) return { statusCode: 304, headers, body: undefined };
    const result = response(context, request, contract);
    return { ...result, headers: { ...result.headers, ...headers } };
  }
  let data: unknown;
  if (attempt?.[1] && request.method === "GET") data = await service.lookup(owner, attempt[1]);
  else if (attempt?.[2] && !attempt[3] && request.method === "GET") data = await service.status(owner, attempt[2]);
  else if (attempt?.[2] && attempt[3] === "result" && request.method === "POST")
    data = await service.submit(owner, attempt[2], idempotencyKeyOf(request), bodyOf(request));
  else if (attempt?.[2] && attempt[3] === "cancel" && request.method === "POST") data = await service.cancel(owner, attempt[2]);
  else if (attempt && !attempt[1] && !attempt[2] && request.method === "POST")
    data = await service.prepare(owner, idempotencyKeyOf(request), bodyOf(request));
  else throw new ApplicationError(405, "REQ_METHOD_NOT_ALLOWED", "不支持该生成操作。");
  const result = response(context, request, data);
  return { ...result, headers: { ...result.headers, "Cache-Control": "no-store" } };
}
