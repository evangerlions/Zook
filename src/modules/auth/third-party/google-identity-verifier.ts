import type { ThirdPartyCredential } from "../../../generated/openapi/public-contracts.generated.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { ThirdPartyAttempt, ThirdPartyClient, ThirdPartyClientSource, ThirdPartyIdentityVerifier } from "./third-party-models.ts";
import { OidcTokenVerifier } from "./oidc-token-verifier.ts";

export class GoogleIdentityVerifier implements ThirdPartyIdentityVerifier {
  private readonly tokens: OidcTokenVerifier;
  constructor(private readonly clients: ThirdPartyClientSource, private readonly fetcher: typeof fetch = fetch) {
    this.tokens = new OidcTokenVerifier("https://www.googleapis.com/oauth2/v3/certs", ["https://accounts.google.com", "accounts.google.com"], fetcher);
  }
  async verify(attempt: ThirdPartyAttempt, credential: ThirdPartyCredential, client: ThirdPartyClient) {
    let token: string;
    if (credential.type === "id_token" && attempt.transport !== "browser") token = credential.idToken;
    else if (credential.type === "authorization_code" && attempt.transport === "browser") {
      if (credential.state !== attempt.state || !attempt.codeVerifier || !attempt.redirectUri)
        badRequest("AUTH_PROVIDER_PROOF_INVALID", "Authorization state is invalid.");
      const secret = client.secretKey ? await this.clients.readSecret(client.secretKey) : undefined;
      try {
        const response = await this.fetcher("https://oauth2.googleapis.com/token", { method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
          body: new URLSearchParams({ client_id: attempt.clientId, ...(secret ? { client_secret: secret } : {}), code: credential.code,
            code_verifier: attempt.codeVerifier, redirect_uri: attempt.redirectUri, grant_type: "authorization_code" }) });
        const result = await response.json() as { id_token?: string };
        if (!response.ok || !result.id_token) badRequest("AUTH_PROVIDER_PROOF_INVALID", "Google authorization could not be verified.");
        token = result.id_token;
      } catch { badRequest("AUTH_PROVIDER_PROOF_INVALID", "Google authorization could not be verified."); }
    } else badRequest("AUTH_PROVIDER_PROOF_INVALID", "Credential does not match the Google authorization flow.");
    const claims = await this.tokens.verify(token, attempt.audience, attempt.nonce);
    return { kind: "google" as const, subject: claims.sub };
  }
}
