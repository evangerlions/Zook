import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { parseSearchInput } from "../modules/ai-novel/search/search-types.ts";

const base = "/api/v1/admin/apps/ai_novel/web-search";
export async function tryHandleAdminAiNovelSearchRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (request.path !== base && !request.path.startsWith(`${base}/`)) return undefined;
  const adminUser = this.authenticateAdmin(request);
  const service = this.aiNovelWebSearchService;
  if (!service) throw new ApplicationError(503, "WEB_SEARCH_UNAVAILABLE", "Search service unavailable.");
  let result: unknown;
  let action: string;
  if (request.path === base && request.method === "GET") { result = await service.config.document(); action = "read"; }
  else if (request.path === base && request.method === "PUT") {
    const body = this.validationPipe.asObject(request.body);
    result = await service.config.save(body.config, this.validationPipe.optionalString(body, "desc")); action = "update";
  } else if (request.path === `${base}/records` && request.method === "GET") { result = { items: await service.usage.records() }; action = "records.read"; }
  else if (request.path === `${base}/test` && request.method === "POST") {
    const body = this.validationPipe.asObject(request.body);
    if (body.region !== "CN" && body.region !== "GLOBAL") throw new ApplicationError(400, "REQ_INVALID_BODY", "Select a valid region.");
    const input = parseSearchInput({ sceneKey: "write_turn", agentProtocol: "pi-v1", toolCallId: request.requestId, query: body.query, limit: body.limit });
    const outcome = await service.execute(input, { userId: `admin-test:${adminUser}`, requestId: request.requestId as string, accountRegion: body.region, appVersion: "1.8.0", signal: request.signal });
    // Operator tests expose only status and counts; raw search data stays private.
    result = outcome.status === "completed" ? { status: outcome.status, resultCount: outcome.results.length } : outcome; action = "test";
  } else {
    const match = request.path.match(/\/revisions\/(\d+)(\/restore)?$/);
    if (!match || !((request.method === "GET" && !match[2]) || (request.method === "POST" && match[2]))) return undefined;
    result = match[2] ? await service.config.restore(Number(match[1]), this.validationPipe.optionalString(this.validationPipe.asObject(request.body ?? {}), "desc")) : await service.config.document(Number(match[1])); action = match[2] ? "restore" : "revision.read";
  }
  await this.recordAdminMutationAudit({ appId: "ai_novel", action: `admin.web_search.${action}`, resourceType: "app_config", resourceId: "ai_novel.web_search", payload: { adminUser } });
  return this.ok(result, request.requestId as string);
}
