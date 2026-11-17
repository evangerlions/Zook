import { createPublicKey, verify } from "node:crypto";
import { badRequest } from "../../../shared/errors.ts";

interface IdClaims { iss: string; sub: string; aud: string; exp: number; iat: number; nonce?: string }
interface SigningKey extends JsonWebKey { kid?: string; alg?: string; use?: string }

export class OidcTokenVerifier {
  constructor(private readonly jwksUrl: string, private readonly issuers: readonly string[],
    private readonly fetcher: typeof fetch = fetch) {}

  async verify(token: string, audience: string, nonce?: string, now = new Date()): Promise<IdClaims> {
    try {
      const parts = token.split(".");
      if (parts.length !== 3) return this.invalid();
      const header = JSON.parse(Buffer.from(parts[0], "base64url").toString()) as { alg?: string; kid?: string };
      if (header.alg !== "RS256" || !header.kid) return this.invalid();
      const response = await this.fetcher(this.jwksUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return this.invalid();
      const jwks = await response.json() as { keys?: SigningKey[] };
      const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === "RSA" && (!key.use || key.use === "sig") && (!key.alg || key.alg === "RS256"));
      if (!jwk || !verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`),
        createPublicKey({ key: jwk, format: "jwk" }), Buffer.from(parts[2], "base64url"))) return this.invalid();
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString()) as IdClaims;
      if (!this.issuers.includes(claims.iss) || claims.aud !== audience || typeof claims.sub !== "string" || !claims.sub
        || !Number.isFinite(claims.exp) || claims.exp * 1000 <= now.getTime()
        || !Number.isFinite(claims.iat) || claims.iat * 1000 > now.getTime() + 60_000
        || (nonce !== undefined && claims.nonce !== nonce)) return this.invalid();
      return claims;
    } catch { return this.invalid(); }
  }

  private invalid(): never { badRequest("AUTH_PROVIDER_PROOF_INVALID", "Third-party authorization is invalid or expired."); }
}
