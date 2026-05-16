import { timingSafeEqual } from "node:crypto";
import { unauthorized } from "../../shared/errors.ts";
import type { AccessTokenPayload, AuthContext } from "../../shared/types.ts";
import { decodeBase64Url, encodeBase64Url, randomId, signValue } from "../../shared/utils.ts";

interface TokenServiceOptions {
  previousSecrets?: string[];
  accessTokenTtlSeconds?: number;
}

/**
 * TokenService issues short-lived bearer tokens whose app scope becomes the post-login source of truth.
 */
export class TokenService {
  private readonly verifySecrets: string[];
  private readonly accessTokenTtlSeconds: number;

  constructor(
    private readonly secret: string,
    options: TokenServiceOptions = {},
  ) {
    this.verifySecrets = [secret, ...(options.previousSecrets ?? []).filter((item) => item && item !== secret)];
    this.accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? 15 * 60;
  }

  issueAccessToken(userId: string, appId: string, tokenVersion = 1, now = new Date()): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      app_id: appId,
      type: "access",
      jti: randomId("atk"),
      ver: tokenVersion,
      iat: issuedAt,
      exp: issuedAt + this.accessTokenTtlSeconds,
    };

    const serializedPayload = encodeBase64Url(JSON.stringify(payload));
    const signature = signValue(this.secret, serializedPayload);
    return `${serializedPayload}.${signature}`;
  }

  verifyAccessToken(token: string, now = new Date()): AuthContext {
    const [serializedPayload, signature] = token.split(".");
    if (!serializedPayload || !signature) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token format is invalid.");
    }

    const signatureIsValid = this.verifySecrets.some((secret) => {
      const expectedSignature = signValue(secret, serializedPayload);
      return signature.length === expectedSignature.length &&
        timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    });

    if (!signatureIsValid) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token signature is invalid.");
    }

    let payload: AccessTokenPayload;
    try {
      payload = JSON.parse(decodeBase64Url(serializedPayload)) as AccessTokenPayload;
    } catch {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is expired or malformed.");
    }

    if (
      payload.type !== "access" ||
      !Number.isInteger(payload.ver) ||
      payload.ver <= 0 ||
      payload.exp <= Math.floor(now.getTime() / 1000)
    ) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is expired or malformed.");
    }

    return {
      userId: payload.sub,
      appId: payload.app_id,
      tokenId: payload.jti,
      tokenVersion: payload.ver,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  get expiresInSeconds(): number {
    return this.accessTokenTtlSeconds;
  }
}
