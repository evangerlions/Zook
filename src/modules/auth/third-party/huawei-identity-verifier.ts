import type { ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import { ApplicationError, badRequest } from "../../../shared/errors.ts";
import { OidcTokenVerifier } from "./oidc-token-verifier.ts";
import type { ThirdPartyAttempt, ThirdPartyClient, ThirdPartyClientSource, ThirdPartyIdentityVerifier } from "./third-party-models.ts";

/** HarmonyOS authorization codes are exchanged only on the server. The returned
 * ID token is verified locally against Huawei's fixed JWKS/issuer, never tokeninfo.
 */
export class HuaweiIdentityVerifier implements ThirdPartyIdentityVerifier {
  private readonly tokens: OidcTokenVerifier;
  constructor(private readonly clients: ThirdPartyClientSource, private readonly fetcher: typeof fetch = fetch) {
    this.tokens = new OidcTokenVerifier("https://oauth-login.cloud.huawei.com/oauth2/v3/certs",
      ["https://accounts.huawei.com"], fetcher, ["PS256", "RS256"]);
  }

  async verify(attempt: ThirdPartyAttempt, credential: ThirdPartyCredential, client: ThirdPartyClient) {
    if (attempt.platform !== "ohos" || attempt.transport !== "sdk" || attempt.clientType !== "app"
      || credential.type !== "authorization_code" || credential.state !== attempt.state)
      badRequest("AUTH_PROVIDER_PROOF_INVALID", "Huawei authorization state or transport is invalid.");
    const secret = client.secretKey && await this.clients.readSecret(client.secretKey);
    if (!secret) throw new ApplicationError(503, "AUTH_PROVIDER_UNAVAILABLE", "Huawei sign-in is not configured.");
    const token = await this.exchange(attempt.clientId, secret, credential.code);
    const claims = await this.tokens.verify(token, attempt.audience, attempt.nonce);
    const name = typeof claims.display_name === "string" ? claims.display_name.trim() : "";
    return { kind: "huawei" as const, subject: `openid:${attempt.clientId}:${claims.sub}`,
      ...(name && name.length <= 100 ? { displayName: name } : {}) };
  }

  private async exchange(clientId: string, secret: string, code: string): Promise<string> {
    try {
      const response = await this.fetcher("https://oauth-login.cloud.huawei.com/oauth2/v3/token", {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
        headers: { "content-type": "application/x-www-form-urlencoded" },
        // Request Huawei's recommended algorithm; legacy RS256 remains explicitly supported.
        body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId,
          client_secret: secret, code, supportAlg: "PS256" }),
      });
      const result = await response.json() as { error?: unknown; id_token?: unknown };
      if (!response.ok || result.error !== undefined || typeof result.id_token !== "string" || !result.id_token)
        badRequest("AUTH_PROVIDER_PROOF_INVALID", "Huawei authorization could not be verified.");
      return result.id_token;
    } catch {
      // Never expose upstream payloads: they can contain codes, tokens or credentials.
      badRequest("AUTH_PROVIDER_PROOF_INVALID", "Huawei authorization could not be verified.");
    }
  }
}
