import { badRequest, forbidden } from "../../shared/errors.ts";
import type { HttpRequest } from "../../shared/types.ts";
import { getHeader } from "../../shared/utils.ts";

/**
 * AppContextResolver encodes the document's pre-login and post-login appId truth rules.
 */
export class AppContextResolver {
  constructor(private readonly domainAppMap = new Map<string, string>()) {}

  resolvePreAuth(request: HttpRequest): string {
    const hostname = request.hostname?.toLowerCase();
    if (hostname && this.domainAppMap.has(hostname)) {
      return this.domainAppMap.get(hostname) as string;
    }

    const forwardedAppId = getHeader(request.headers, "x-app-id");
    if (request.trustedProxy && forwardedAppId) {
      return forwardedAppId;
    }

    const explicitAppId = this.extractExplicitAppId(request);
    if (explicitAppId) {
      return explicitAppId;
    }

    badRequest("REQ_INVALID_BODY", "appId is required before authentication.");
  }

  resolvePostAuth(request: HttpRequest, tokenAppId: string): string {
    const forwardedAppId = getHeader(request.headers, "x-app-id");
    if (forwardedAppId && forwardedAppId !== tokenAppId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "X-App-Id does not match the bearer token app scope.");
    }

    return tokenAppId;
  }

  extractExplicitAppId(request: HttpRequest): string | undefined {
    const body = request.body;
    if (body && typeof body === "object" && !Array.isArray(body) && typeof body.appId === "string") {
      return body.appId;
    }

    if (typeof request.query?.appId === "string") {
      return request.query.appId;
    }

    return undefined;
  }
}
