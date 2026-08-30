import { createSign, createPrivateKey, type KeyObject } from "node:crypto";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { PushDispatchRequest, PushDispatcher } from "./notification.service.ts";

export interface ApnsConfig {
  /** Apple Developer Team ID (10-char string, e.g. "ABC123DEF4") */
  teamId: string;
  /** APNs auth key ID (10-char string from Apple Developer portal) */
  keyId: string;
  /** App bundle ID used as the APNs topic (e.g. "com.hulusleep.app") */
  bundleId: string;
  bundleIds?: Record<string, string>;
  /** APNs auth key private key in PEM format (.p8 file contents) */
  privateKeyPem: string;
  /** Use production APNs endpoint (defaults to true; false = sandbox) */
  production: boolean;
}

interface ApnsTokenCache {
  token: string;
  /** Issued-at time in epoch seconds */
  issuedAt: number;
}

const PRODUCTION_ENDPOINT = "https://api.push.apple.com";
const SANDBOX_ENDPOINT = "https://api.sandbox.push.apple.com";

/** APNs JWT tokens are valid for 1 hour; refresh proactively at 50 minutes */
const TOKEN_REFRESH_SECONDS = 50 * 60;
const APNS_ALERT_EXPIRATION_SECONDS = 24 * 60 * 60;

/**
 * APNs (Apple Push Notification service) push dispatcher.
 *
 * Sends push notifications to iOS devices via the APNs HTTP/2 API using
 * token-based (JWT) authentication with an ES256 .p8 key.
 *
 * Only dispatches to devices with `platform === "ios"`. Other platforms are
 * silently skipped so this dispatcher can be part of a composite router.
 */
export class ApnsPushDispatcher implements PushDispatcher {
  private readonly endpoint: string;
  private readonly privateKey: KeyObject;
  private cachedToken: ApnsTokenCache | null = null;
  private readonly fetchImpl: typeof fetch;
  private readonly logger: StructuredLogger | null;
  private readonly database: ApplicationDatabase | null;

  constructor(
    private readonly config: ApnsConfig,
    options: {
      fetchImplementation?: typeof fetch;
      logger?: StructuredLogger;
      database?: ApplicationDatabase;
    } = {},
  ) {
    this.endpoint = config.production ? PRODUCTION_ENDPOINT : SANDBOX_ENDPOINT;
    this.privateKey = createPrivateKey(config.privateKeyPem);
    this.fetchImpl = options.fetchImplementation ?? globalThis.fetch;
    this.logger = options.logger ?? null;
    this.database = options.database ?? null;
  }

  async dispatch(request: PushDispatchRequest): Promise<void> {
    if (request.platform !== "ios") {
      return;
    }

    const token = await this.getBearerToken();
    const url = `${this.endpoint}/3/device/${request.pushToken}`;

    const apnsPayload = this.buildApnsPayload(request);
    const apnsExpiration = Math.floor(Date.now() / 1000) + APNS_ALERT_EXPIRATION_SECONDS;

    const response = await this.fetchImpl(url, {
      method: "POST",
      headers: {
        "authorization": `bearer ${token}`,
        "apns-topic": this.config.bundleIds?.[request.appId] ?? this.config.bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "apns-expiration": String(apnsExpiration),
        "content-type": "application/json",
      },
      body: JSON.stringify(apnsPayload),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let reason: string;
      try {
        const parsed = JSON.parse(errorBody);
        reason = parsed.reason ?? errorBody;
      } catch {
        reason = errorBody;
      }

      if (this.isRetryableError(response.status, reason)) {
        throw new ApnsRetryableError(
          `APNs push failed (${response.status}): ${reason}`,
          response.status,
          reason,
        );
      }

      if (this.isUnrecoverableError(reason)) {
        this.logger?.warn("APNs device token unrecoverable, removing device", {
          appId: request.appId,
          userId: request.userId,
          reason,
        });
        await request.invalidateToken?.();
        await this.removeInvalidDevice(request, reason);
        return;
      }

      throw new ApnsPushError(
        `APNs push failed (${response.status}): ${reason}`,
        response.status,
        reason,
      );
    }

    this.logger?.info("APNs push delivered", {
      appId: request.appId,
      userId: request.userId,
      notificationType: request.payload.type,
    });
  }

  private buildApnsPayload(request: PushDispatchRequest): Record<string, unknown> {
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
      aps: {
        alert: {
          title: request.payload.title,
          body: request.payload.body,
        },
        sound: "default",
        category: this.mapCategory(request.payload.app, request.payload.type),
      },
      ...customData,
    };
  }

  private mapCategory(app: string, type: string): string {
    return `${app.toUpperCase()}_${type.toUpperCase()}`;
  }

  private async getBearerToken(): Promise<string> {
    const nowSeconds = Math.floor(Date.now() / 1000);

    if (
      this.cachedToken &&
      nowSeconds - this.cachedToken.issuedAt < TOKEN_REFRESH_SECONDS
    ) {
      return this.cachedToken.token;
    }

    const header = {
      alg: "ES256",
      kid: this.config.keyId,
    };
    const claim = {
      iss: this.config.teamId,
      iat: nowSeconds,
    };

    const headerB64 = base64UrlEncode(JSON.stringify(header));
    const claimB64 = base64UrlEncode(JSON.stringify(claim));
    const signingInput = `${headerB64}.${claimB64}`;

    const signer = createSign("SHA256");
    signer.update(signingInput);
    signer.end();
    const signature = signer.sign({
      key: this.privateKey,
      dsaEncoding: "ieee-p1363",
    });
    const signatureB64 = base64UrlEncodeBuffer(signature);

    const token = `${signingInput}.${signatureB64}`;
    this.cachedToken = { token, issuedAt: nowSeconds };
    return token;
  }

  private isRetryableError(status: number, _reason: string): boolean {
    if (status === 429 || status >= 500) {
      return true;
    }
    return false;
  }

  private isUnrecoverableError(reason: string): boolean {
    const unrecoverableReasons = [
      "BadDeviceToken",
      "Unregistered",
      "DeviceTokenNotForTopic",
    ];
    return unrecoverableReasons.includes(reason);
  }

  private async removeInvalidDevice(request: PushDispatchRequest, reason: string): Promise<void> {
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
          this.logger?.info("APNs invalid device removed", {
            appId: request.appId,
            userId: request.userId,
            deviceId: device.id,
            reason,
          });
          break;
        }
      }
    } catch (error) {
      this.logger?.error("failed to remove invalid APNs device", {
        appId: request.appId,
        userId: request.userId,
        reason,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
  }
}

export class ApnsPushError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly reason: string,
  ) {
    super(message);
    this.name = "ApnsPushError";
  }
}

export class ApnsRetryableError extends ApnsPushError {
  constructor(message: string, statusCode: number, reason: string) {
    super(message, statusCode, reason);
    this.name = "ApnsRetryableError";
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
