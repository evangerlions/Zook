import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { getHeader } from "../shared/utils.ts";
import { handleEncryptedAiRequest } from "./encrypted-ai-routes.ts";
import { parseSearchInput } from "../modules/ai-novel/search/search-types.ts";

export async function tryHandleAiNovelWebSearchRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "POST" || request.path !== "/api/v1/ai_novel/ai/web-search") return undefined;
  return handleEncryptedAiRequest.call(this, request, async (body, auth) => {
    if (!this.aiNovelWebSearchService) throw new ApplicationError(503, "WEB_SEARCH_UNAVAILABLE", "Search is not configured.");
    return this.aiNovelWebSearchService.execute(parseSearchInput(body), { userId: auth.userId, requestId: request.requestId as string, accountRegion: await this.resolveAccountRegion(request, "ai_novel", auth.userId), appVersion: getHeader(request.headers, "x-app-version"), signal: request.signal });
  });
}
