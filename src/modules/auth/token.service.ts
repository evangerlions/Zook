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

  issueAccessToken(userId: string, appId: string, tokenVersion = 1, now = new Date(), credentialVersion?: number): string {
    const issuedAt = Math.floor(now.getTime() / 1000);
    const payload: AccessTokenPayload = {
      sub: userId,
      credential_ver: credentialVersion,
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
    const parts = token.split(".");
    const [serializedPayload, signature] = parts;
    if (parts.length !== 2 || !serializedPayload || !signature ||
      !/^[A-Za-z0-9_-]+$/.test(serializedPayload) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
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
      !payload || typeof payload !== "object" || Array.isArray(payload) ||
      typeof payload.sub !== "string" || !payload.sub ||
      typeof payload.app_id !== "string" || !payload.app_id ||
      typeof payload.jti !== "string" || !payload.jti ||
      payload.type !== "access" ||
      !Number.isInteger(payload.iat) ||
      !Number.isInteger(payload.exp) ||
      !Number.isFinite(new Date(payload.exp * 1000).getTime()) ||
      !Number.isInteger(payload.ver) ||
      payload.ver <= 0 ||
      (payload.credential_ver !== undefined && (!Number.isInteger(payload.credential_ver) || payload.credential_ver <= 0)) ||
      payload.exp <= Math.floor(now.getTime() / 1000)
    ) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is expired or malformed.");
    }

    return {
      userId: payload.sub,
      credentialVersion: payload.credential_ver,
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
