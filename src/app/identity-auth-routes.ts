import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { badRequest, ApplicationError } from "../shared/errors.ts";
import { getHeader } from "../shared/utils.ts";
import { identityContracts } from "../modules/auth/identity/identity-auth-contracts.ts";
import type { ThirdPartyRequestContext } from "../modules/auth/third-party/third-party-auth.service.ts";

export function ownsIdentityAuthTransaction(path: string): boolean {
  return path === "/api/v1/auth/identity-changes" || path.startsWith("/api/v1/auth/identity-changes/")
    || path === "/api/v1/auth/third-party/authorizations" || path === "/api/v1/auth/login/third-party";
}

export async function tryHandleIdentityAuthRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (request.method !== "POST" || !ownsIdentityAuthTransaction(request.path)) return undefined;
  const runtime = this.identityAuth;
  if (!runtime) throw new ApplicationError(503, "AUTH_PROVIDER_UNAVAILABLE", "Identity authentication is unavailable.");
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  this.appAccessGuard.assertScope(appId, this.validationPipe.requireString(body, "appId"));
  if (request.path === "/api/v1/auth/third-party/authorizations") {
    const input = identityContracts.authorization(body);
    const auth = input.purpose === "identity_change" ? await this.authenticate(request) : undefined;
    return this.ok(await runtime.thirdParty.create(input, providerContext(request, input.regionSource), auth), request.requestId!);
  }
  if (request.path === "/api/v1/auth/login/third-party") {
    const input = identityContracts.login(body);
    const context = providerContext(request, input.regionSource);
    assertClientType(context, input.clientType);
    const result = await runtime.thirdParty.login(input.appId, input.authorizationId, input.credential, context);
    const payload = await this.toAuthPayload(result.session, input.clientType, request);
    const nextAction = await runtime.directory.offerPhonePrompt(input.appId, result.session.userId, result.provider, context.region);
    return this.ok({ ...payload, nextAction }, request.requestId!, this.buildAuthHeaders(result.session.refreshToken, input.clientType));
  }
  const auth = await this.authenticate(request);
  this.appAccessGuard.assertScope(appId, auth.appId);
  if (request.path === "/api/v1/auth/identity-changes")
    return this.ok(await runtime.changes.create(auth, identityContracts.create(body)), request.requestId!);
  const match = request.path.match(/^\/api\/v1\/auth\/identity-changes\/([^/]+)\/(codes|verify-current|complete)$/);
  if (!match) return undefined;
  const id = decodeURIComponent(match[1]);
  const emailContext = await runtime.deliveryContext(request);
  const context = { ipAddress: request.ipAddress || "unknown", locale: emailContext.locale, emailRegion: emailContext.region };
  switch (match[2]) {
    case "codes": return this.ok(await runtime.changes.sendCode(auth, id, identityContracts.code(body), context), request.requestId!);
    case "verify-current": return this.ok(await runtime.changes.verifyCurrent(auth, id, identityContracts.current(body), context), request.requestId!);
    case "complete": {
      const input = identityContracts.complete(body);
      const thirdPartyContext = input.proof.type === "third_party" ? providerContext(request, input.regionSource) : undefined;
      if (thirdPartyContext) assertClientType(thirdPartyContext, input.clientType);
      const result = await runtime.complete(auth, id, input, context, thirdPartyContext);
      const session = await this.toAuthPayload(result.session, input.clientType, request);
      return this.ok({ changeId: id, status: "applied", session }, request.requestId!, this.buildAuthHeaders(result.session.refreshToken, input.clientType));
    }
  }
}

function providerContext(request: HttpRequest, regionSource?: string): ThirdPartyRequestContext {
  const platform = getHeader(request.headers, "x-platform")?.trim().toLowerCase();
  if (platform !== "ios" && platform !== "android" && platform !== "ohos" && platform !== "macos" && platform !== "windows" && platform !== "web")
    badRequest("REQ_INVALID_BODY", "A supported platform is required.");
  const region = platform === "ohos" ? "CN" : getHeader(request.headers, "x-app-region")?.trim().toUpperCase();
  if (region !== "CN" && region !== "GLOBAL") badRequest("REQ_INVALID_BODY", "A product region is required.");
  return { platform, region, regionSource };
}

function assertClientType(context: ThirdPartyRequestContext, clientType: "app" | "web"): void {
  if ((context.platform === "web") !== (clientType === "web")) badRequest("REQ_INVALID_BODY", "Client type does not match the platform.");
}
