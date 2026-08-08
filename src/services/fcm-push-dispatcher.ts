import { createSign, createPrivateKey } from "node:crypto";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { PushDispatchRequest, PushDispatcher } from "./notification.service.ts";

export interface FcmConfig {
  /** Firebase project ID */
  projectId: string;
  /** Service account client email (used as JWT "sub" and OAuth identity) */
  clientEmail: string;
  /** Service account private key in PEM format */
  privateKeyPem: string;
}

interface FcmTokenCache {
  accessToken: string;
  /** Expiry time in epoch milliseconds */
  expiresAt: number;
}

const FCM_SEND_URL = "https://fcm.googleapis.com/v1/projects";
const OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging";

/** Refresh 5 minutes before actual expiry */
const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/**
 * FCM (Firebase Cloud Messaging) v1 API push dispatcher.
 *
 * Sends push notifications to Android devices via the FCM v1 HTTP API using
 * OAuth2 JWT-bearer grant authentication with a Google service account.
 *
 * Only dispatches to devices with `platform === "android"`. Other platforms
 * are silently skipped.
 *
 * When FCM reports a device token as unregistered or invalid, the device
 * record is automatically soft-deleted via the database to prevent future
 * delivery attempts.
 */
export class FcmPushDispatcher implements PushDispatcher {
  private cachedToken: FcmTokenCache | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: StructuredLogger | null;
  private readonly database: ApplicationDatabase | null;

  constructor(
    private readonly config: FcmConfig,
    options: {
      fetchImplementation?: typeof fetch;
      logger?: StructuredLogger;
      database?: ApplicationDatabase;
    } = {},
  ) {
    this.fetchImpl = options.fetchImplementation ?? globalThis.fetch;
    this.logger = options.logger ?? null;
    this.database = options.database ?? null;
  }

  async dispatch(request: PushDispatchRequest): Promise<void> {
    if (request.platform !== "android") {
      return;
    }

    const accessToken = await this.getAccessToken();
    const url = `${FCM_SEND_URL}/${this.config.projectId}/messages:send`;

    const fcmMessage = this.buildFcmMessage(request);

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ message: fcmMessage }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let errorMessage: string;
      let errorCode: string | null = null;
      try {
        const parsed = JSON.parse(errorBody);
        errorMessage = parsed.error?.message ?? errorBody;
        errorCode = parsed.error?.status ?? null;
      } catch {
        errorMessage = errorBody;
      }

      if (this.isUnrecoverableError(errorCode, errorMessage)) {
        this.logger?.warn("FCM device token unrecoverable, removing device", {
          appId: request.appId,
          userId: request.userId,
          pushToken: request.pushToken,
          errorCode,
        });
        await this.removeInvalidDevice(request);
        return;
      }

      if (this.isRetryableError(response.status)) {
        throw new FcmRetryableError(
          `FCM push failed (${response.status}): ${errorMessage}`,
          response.status,
          errorMessage,
        );
      }

      throw new FcmPushError(
        `FCM push failed (${response.status}): ${errorMessage}`,
        response.status,
        errorMessage,
      );
    }

    this.logger?.info("FCM push delivered", {
      appId: request.appId,
      userId: request.userId,
      notificationType: request.payload.type,
    });
  }

  private buildFcmMessage(request: PushDispatchRequest): Record<string, unknown> {
    const customData: Record<string, string> = {
      app: request.payload.app,
      type: request.payload.type,
    };

    if (request.payload.entityId) {
      customData.entityId = request.payload.entityId;
    }
    if (request.payload.relationshipId) {
      customData.relationshipId = request.payload.relationshipId;
    }
    if (request.payload.sessionId) {
      customData.sessionId = request.payload.sessionId;
    }

    for (const [key, value] of Object.entries(request.payload.data)) {
      customData[key] = value;
    }

    return {
      token: request.pushToken,
      notification: {
        title: request.payload.title,
        body: request.payload.body,
      },
      data: customData,
      android: {
        priority: "high",
      },
    };
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();

    if (this.cachedToken && now < this.cachedToken.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
      return this.cachedToken.accessToken;
    }

    const nowSeconds = Math.floor(now / 1000);
    const expirySeconds = nowSeconds + 3600;

    const header = { alg: "RS256", typ: "JWT" };
    const claim = {
      iss: this.config.clientEmail,
      scope: FCM_SCOPE,
      aud: OAUTH_TOKEN_URL,
      iat: nowSeconds,
      exp: expirySeconds,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const claimB64 = base64UrlEncode(JSON.stringify(claim));
    const signingInput = `${headerB64}.${claimB64}`;

    const privateKey = createPrivateKey(this.config.privateKeyPem);
    const signer = createSign("SHA256");
    signer.update(signingInput);
    signer.end();
    const signatureDer = signer.sign(privateKey);
    const signatureB64 = base64UrlEncodeBuffer(signatureDer);

    const assertion = `${signingInput}.${signatureB64}`;

    const tokenResponse = await this.fetchImpl(OAUTH_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
    });

    if (!tokenResponse.ok) {
      const errorBody = await tokenResponse.text().catch(() => "");
      throw new FcmPushError(
        `FCM OAuth token request failed (${tokenResponse.status}): ${errorBody}`,
        tokenResponse.status,
        errorBody,
      );
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      expires_in: number;
    };

    this.cachedToken = {
      accessToken: tokenData.access_token,
      expiresAt: now + tokenData.expires_in * 1000,
    };

    return tokenData.access_token;
  }

  private isRetryableError(status: number): boolean {
    return status === 429 || status >= 500;
  }

  private isUnrecoverableError(errorCode: string | null, message: string): boolean {
    if (errorCode === "NOT_FOUND" || errorCode === "INVALID_ARGUMENT") {
      return true;
    }
    if (message.includes("not a valid FCM registration token") ||
        message.includes("has expired") ||
        message.includes("entity not found")) {
      return true;
    }
    return false;
  }

  private async removeInvalidDevice(request: PushDispatchRequest): Promise<void> {
    if (!this.database) return;

    try {
      const devices = await this.database.listFrogSleepDevices({
        appId: request.appId,
        userId: request.userId,
        pushEnabled: true,
      });

      for (const device of devices) {
        if (device.pushToken === request.pushToken) {
          await this.database.deleteFrogSleepDevice(device.appId, device.userId, device.id);
          break;
        }
      }
    } catch (error) {
      this.logger?.error("failed to remove invalid FCM device", {
        appId: request.appId,
        userId: request.userId,
        pushToken: request.pushToken,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

export class FcmPushError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "FcmPushError";
  }
}

export class FcmRetryableError extends FcmPushError {
  constructor(message: string, statusCode: number, detail: string) {
    super(message, statusCode, detail);
    this.name = "FcmRetryableError";
  }
}

function base64UrlEncode(input: string): string {
  return base64UrlEncodeBuffer(Buffer.from(input, "utf8"));
}

function base64UrlEncodeBuffer(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}
