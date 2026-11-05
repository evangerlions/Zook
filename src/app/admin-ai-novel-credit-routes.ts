import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const root = "/api/v1/admin/apps/ai_novel/credit-grants";
export async function tryHandleAdminAiNovelCreditRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const search = request.method === "GET" && request.path === `${root}/users`;
  const records = request.method === "GET" && request.path === root;
  const grant = request.method === "POST" && request.path === root;
  if (!search && !records && !grant) return undefined;
  const session = this.requireAdminSession(request);
  const data = search ? await this.aiNovelCreditAdminService.search(request.query?.field, request.query?.query)
    : records ? await this.aiNovelCreditAdminService.records(request.query?.offset)
    : await this.aiNovelCreditAdminService.grant(this.validationPipe.asObject(request.body), session.username);
  return this.ok(data, request.requestId as string, { "Cache-Control": "no-store" });
}
