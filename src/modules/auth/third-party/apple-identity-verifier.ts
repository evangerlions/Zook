import { sign } from "node:crypto";
import type { ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { ThirdPartyAttempt, ThirdPartyClient, ThirdPartyClientSource, ThirdPartyIdentityVerifier } from "./third-party-models.ts";
import { OidcTokenVerifier } from "./oidc-token-verifier.ts";

export class AppleIdentityVerifier implements ThirdPartyIdentityVerifier {
  private readonly tokens: OidcTokenVerifier;
  constructor(private readonly clients: ThirdPartyClientSource, private readonly fetcher: typeof fetch = fetch) {
    this.tokens = new OidcTokenVerifier("https://appleid.apple.com/auth/keys", ["https://appleid.apple.com"], fetcher);
  }
  async verify(attempt: ThirdPartyAttempt, credential: ThirdPartyCredential, client: ThirdPartyClient) {
    if (credential.type !== "apple") badRequest("AUTH_PROVIDER_PROOF_INVALID", "Apple authorization is required.");
    const claims = await this.tokens.verify(credential.identityToken, attempt.audience, attempt.nonce);
    const privateKey = client.secretKey && await this.clients.readSecret(client.secretKey);
    if (!privateKey || !client.teamId || !client.keyId) badRequest("AUTH_PROVIDER_UNAVAILABLE", "Apple sign-in is not configured.");
    try {
      const now = Math.floor(Date.now() / 1000);
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const message = `${encode({ alg: "ES256", kid: client.keyId })}.${encode({ iss: client.teamId, iat: now, exp: now + 300, aud: "https://appleid.apple.com", sub: client.clientId })}`;
      const clientSecret = `${message}.${sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding: "ieee-p1363" }).toString("base64url")}`;
      const response = await this.fetcher("https://appleid.apple.com/auth/token", { method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
        body: new URLSearchParams({ client_id: client.clientId, client_secret: clientSecret,
          code: credential.authorizationCode, grant_type: "authorization_code" }) });
      const result = await response.json() as { id_token?: string };
      if (!response.ok || !result.id_token) badRequest("AUTH_PROVIDER_PROOF_INVALID", "Apple authorization could not be verified.");
      const exchanged = await this.tokens.verify(result.id_token, attempt.audience, attempt.nonce);
      if (exchanged.sub !== claims.sub) badRequest("AUTH_PROVIDER_PROOF_INVALID", "Apple authorization identity does not match.");
      return { kind: "apple" as const, subject: claims.sub };
    } catch { badRequest("AUTH_PROVIDER_PROOF_INVALID", "Apple authorization could not be verified."); }
  }
}
