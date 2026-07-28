import type { HttpRequest, HttpResponse } from "../shared/types.ts";

const ASSOCIATION_PATH = "/.well-known/apple-app-site-association";
const BODYLOG_APPLICATION_IDENTIFIER = "LTN9Y4UXN3.com.youwoai.habittap";

export function tryHandleBodyLogAssociationRoutes(
  request: HttpRequest,
): HttpResponse<unknown> | undefined {
  if (request.method !== "GET" || request.path !== ASSOCIATION_PATH) {
    return undefined;
  }
  return {
    statusCode: 200,
    contentType: "application/json",
    headers: { "Cache-Control": "public, max-age=3600" },
    body: {
      applinks: {
        apps: [],
        details: [{
          appID: BODYLOG_APPLICATION_IDENTIFIER,
          paths: ["/i/*"],
        }],
      },
    } as never,
  };
}
