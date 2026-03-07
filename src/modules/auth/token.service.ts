import { timingSafeEqual } from "node:crypto";
import { unauthorized } from "../../shared/errors.ts";
import type { AccessTokenPayload, AuthContext } from "../../shared/types.ts";
import { decodeBase64Url, encodeBase64Url, randomId, signValue } from "../../shared/utils.ts";

/**
 * TokenService issues short-lived bearer tokens whose app scope becomes the post-login source of truth.
 */
export class TokenService {
  constructor(
    private readonly secret: string,
    private readonly accessTokenTtlSeconds = 15 * 60,
  ) {}

  issueAccessToken(userId: string, appId: string, now = new Date()): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      app_id: appId,
      type: "access",
      jti: randomId("atk"),
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

    const expectedSignature = signValue(this.secret, serializedPayload);
    if (
      signature.length !== expectedSignature.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))
    ) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token signature is invalid.");
    }

    const payload = JSON.parse(decodeBase64Url(serializedPayload)) as AccessTokenPayload;
    if (payload.type !== "access" || payload.exp <= Math.floor(now.getTime() / 1000)) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is expired or malformed.");
    }

    return {
      userId: payload.sub,
      appId: payload.app_id,
      tokenId: payload.jti,
      expiresAt: new Date(payload.exp * 1000).toISOString(),
    };
  }

  get expiresInSeconds(): number {
    return this.accessTokenTtlSeconds;
  }
}
