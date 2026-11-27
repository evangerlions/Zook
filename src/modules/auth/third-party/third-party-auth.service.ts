import { createHash } from "node:crypto";
import type { KVManager } from "../../../infrastructure/kv/kv-manager.ts";
import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { AuthService } from "../auth.service.ts";
import type { AppRegistryService } from "../../app-registry/app-registry.service.ts";
import type { PasswordHasher } from "../password-hasher.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import type { AuthContext } from "../../../shared/types.ts";
import type { ThirdPartyAuthorizationRequest, ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import { ApplicationError, badRequest, forbidden } from "../../../shared/errors.ts";
import { createOpaqueToken, sha256 } from "../../../shared/utils.ts";
import { AuthIdentityDirectory } from "../identity/auth-identity-directory.ts";
import type { IdentityChangeService } from "../identity/identity-change.service.ts";
import { supportsThirdParty, type AuthPlatform, type ProductRegion, type ThirdPartyAttempt, type ThirdPartyClient,
  type ThirdPartyClientSource, type ThirdPartyIdentityVerifier } from "./third-party-models.ts";
import type { ThirdPartyProvider } from "../identity/auth-identity-models.ts";

export interface ThirdPartyRequestContext {
  platform: AuthPlatform;
  region: ProductRegion;
  regionSource?: string;
}
const platforms: AuthPlatform[] = ["ios", "android", "ohos", "macos", "windows", "web"];
const providers: ThirdPartyProvider[] = ["wechat", "google", "apple", "huawei"];

export class ThirdPartyAuthService {
  private readonly scope = "auth.third-party-attempts";
  private readonly directory: AuthIdentityDirectory;
  constructor(private readonly deps: {
    database: ApplicationDatabase; kv: KVManager; clients: ThirdPartyClientSource;
    verifiers: Record<ThirdPartyProvider, ThirdPartyIdentityVerifier>; changes: IdentityChangeService;
    auth: AuthService; registry: AppRegistryService; hasher: PasswordHasher; logger: StructuredLogger;
  }) { this.directory = new AuthIdentityDirectory(deps.database); }

  async capabilities(appId: string) {
    const result: { provider: ThirdPartyProvider; platforms: AuthPlatform[]; regions: ProductRegion[] }[] = [];
    if (appId !== "ai_novel") return result;
    for (const provider of providers) {
      const available: AuthPlatform[] = [];
      for (const platform of platforms) {
        const client = await this.deps.clients.get(appId, platform, provider);
        if (client && (["CN", "GLOBAL"] as const).some(region => supportsThirdParty(platform, region, provider))
          && await this.ready(provider, client)) available.push(platform);
      }
      if (available.length) result.push({ provider, platforms: available,
        regions: provider === "wechat" ? ["CN"] : provider === "google" ? ["GLOBAL"] : ["CN", "GLOBAL"] });
    }
    return result;
  }

  async create(input: ThirdPartyAuthorizationRequest, context: ThirdPartyRequestContext, auth?: AuthContext) {
    this.assertPolicy(input.appId, input.provider, context);
    if ((context.platform === "web") !== (input.clientType === "web")) badRequest("REQ_INVALID_BODY", "Client type does not match the platform.");
    const client = await this.deps.clients.get(input.appId, context.platform, input.provider);
    if (!client || !await this.ready(input.provider, client)) this.unavailable();
    if (input.purpose === "identity_change") {
      if (!auth || auth.appId !== input.appId || !input.changeId) forbidden("AUTH_APP_SCOPE_MISMATCH", "An authenticated identity change is required.");
      const change = await this.deps.changes.get(auth, input.changeId);
      if (!change.currentVerified) forbidden("AUTH_VERIFICATION_REQUIRED", "Verify an existing sign-in method first.");
      if (change.kind !== input.provider) badRequest("REQ_INVALID_BODY", "Provider does not match the identity change.");
    } else if (input.changeId) badRequest("REQ_INVALID_BODY", "Login authorization cannot reference a binding change.");
    const attempt: ThirdPartyAttempt = { id: createOpaqueToken("authorization"), appId: input.appId,
      provider: input.provider, platform: context.platform, region: context.region, purpose: input.purpose,
      clientType: input.clientType, clientId: client.clientId, audience: client.serverClientId || client.clientId,
      transport: context.platform === "web" ? "google_web" : context.platform === "windows" ? "browser" : "sdk",
      nonce: createOpaqueToken("nonce"), state: createOpaqueToken("state"), expiresAt: new Date(Date.now() + 300_000).toISOString(),
      ...(input.purpose === "identity_change" ? { userId: auth!.userId, changeId: input.changeId } : {}) };
    if (attempt.transport === "browser") {
      attempt.redirectUri = this.loopbackRedirect(input.redirectUri);
      attempt.codeVerifier = createOpaqueToken("pkce") + createOpaqueToken("pkce");
    } else if (input.redirectUri) badRequest("REQ_INVALID_BODY", "Redirect URI is only used by desktop browser authorization.");
    await this.deps.kv.setJson(this.scope, sha256(attempt.id), attempt, 300);
    this.deps.logger.info("auth.third_party.authorization_created", { appId: input.appId, provider: input.provider,
      platform: context.platform, purpose: input.purpose });
    return { authorizationId: attempt.id, provider: attempt.provider, expiresInSeconds: 300,
      parameters: { transport: attempt.transport, clientId: client.clientId,
        ...(client.serverClientId ? { serverClientId: client.serverClientId } : {}), nonce: attempt.nonce, state: attempt.state,
        ...(attempt.redirectUri ? { redirectUri: attempt.redirectUri, authorizationUrl: this.browserUrl(attempt) } : {}) } };
  }

  async verify(appId: string, authorizationId: string, credential: ThirdPartyCredential, context: ThirdPartyRequestContext,
    purpose: ThirdPartyAttempt["purpose"], auth?: AuthContext, changeId?: string) {
    const attempt = await this.deps.kv.getJson<ThirdPartyAttempt>(this.scope, sha256(authorizationId));
    if (!attempt || attempt.appId !== appId || attempt.platform !== context.platform || attempt.region !== context.region
      || attempt.purpose !== purpose || new Date(attempt.expiresAt).getTime() <= Date.now()
      || (purpose === "identity_change" && (attempt.userId !== auth?.userId || attempt.changeId !== changeId)))
      badRequest("AUTH_PROVIDER_PROOF_INVALID", "Authorization attempt is invalid or expired.");
    this.assertPolicy(appId, attempt.provider, context);
    const client = await this.deps.clients.get(appId, attempt.platform, attempt.provider);
    if (!client || client.clientId !== attempt.clientId || (client.serverClientId || client.clientId) !== attempt.audience) this.unavailable();
    const identity = await this.deps.verifiers[attempt.provider].verify(attempt, credential, client);
    const remaining = new Date(attempt.expiresAt).getTime() - Date.now();
    if (identity.kind !== attempt.provider || remaining <= 0 || !await this.deps.kv.setStringIfAbsent(this.scope,
      `consumed:${sha256(authorizationId)}`, "1", Math.max(1, Math.ceil(remaining / 1000))))
      badRequest("AUTH_PROVIDER_PROOF_INVALID", "Authorization attempt was already used or expired.");
    return { identity, attempt };
  }

  async login(appId: string, authorizationId: string, credential: ThirdPartyCredential, context: ThirdPartyRequestContext) {
    const { identity, attempt } = await this.verify(appId, authorizationId, credential, context, "login");
    const { user } = await this.directory.resolveVerified({ appId, kind: identity.kind, subject: identity.subject,
      registry: this.deps.registry, hasher: this.deps.hasher, now: new Date(), displayName: identity.displayName });
    const session = await this.deps.auth.issueSession(user.id, appId);
    this.deps.logger.info("auth.third_party.login_verified", { appId, userId: user.id, provider: identity.kind, platform: attempt.platform });
    return { session, provider: identity.kind };
  }

  private assertPolicy(appId: string, provider: ThirdPartyProvider, context: ThirdPartyRequestContext) {
    if (appId !== "ai_novel" || !supportsThirdParty(context.platform, context.region, provider)
      || (context.platform === "windows" && (!context.regionSource || context.regionSource === "fallback"))) this.unavailable();
  }
  private async ready(provider: ThirdPartyProvider, client: ThirdPartyClient): Promise<boolean> {
    if (!client.clientId) return false;
    if (provider === "google") return !client.secretKey || !!await this.deps.clients.readSecret(client.secretKey);
    return !!client.secretKey && !!await this.deps.clients.readSecret(client.secretKey)
      && (provider !== "apple" || !!client.teamId && !!client.keyId);
  }
  private loopbackRedirect(value?: string): string {
    try {
      const url = new URL(value || "");
      if (url.protocol === "http:" && url.hostname === "127.0.0.1" && url.port && url.pathname === "/callback"
        && !url.search && !url.hash && !url.username && !url.password) return url.toString();
    } catch { /* Invalid transport input is mapped to the request contract. */ }
    badRequest("REQ_INVALID_BODY", "A loopback callback URI is required for Windows authorization.");
  }
  private browserUrl(attempt: ThirdPartyAttempt): string {
    const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    url.search = new URLSearchParams({ client_id: attempt.clientId, response_type: "code", scope: "openid email profile",
      redirect_uri: attempt.redirectUri!, state: attempt.state, nonce: attempt.nonce,
      code_challenge: createHash("sha256").update(attempt.codeVerifier!).digest("base64url"), code_challenge_method: "S256" }).toString();
    return url.toString();
  }
  private unavailable(): never { throw new ApplicationError(503, "AUTH_PROVIDER_UNAVAILABLE", "This sign-in method is not available."); }
}
