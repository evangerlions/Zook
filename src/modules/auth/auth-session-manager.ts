import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import {
  badRequest,
  forbidden,
  unauthorized,
} from "../../shared/errors.ts";
import type {
  AccountDeletionResult,
  AuthContext,
  AuthSession,
  ClientType,
  LogoutCommand,
  RefreshCommand,
} from "../../shared/types.ts";
import { createOpaqueToken, randomId, sha256 } from "../../shared/utils.ts";
import { RefreshTokenStore } from "../../services/refresh-token-store.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { UserService } from "../user/user.service.ts";
import { TokenService } from "./token.service.ts";
import { KVManager } from "../../infrastructure/kv/kv-manager.ts";

export class AuthSessionManager {
  private readonly accessTokenVersionScope = "auth.access-token-versions";
  private readonly refreshTokenTtlMs = 60 * 24 * 60 * 60 * 1000;

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
    private readonly userService: UserService,
    private readonly appRegistryService: AppRegistryService,
    private readonly tokenService: TokenService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly secureRefreshCookie = false,
    private readonly refreshCookieSameSite: "Lax" | "None" | "Strict" = "Lax",
  ) {}

  async refresh(
    command: RefreshCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const rawRefreshToken = command.cookieRefreshToken ?? command.refreshToken;
    if (!rawRefreshToken) {
      unauthorized("AUTH_REFRESH_TOKEN_REQUIRED", "Refresh token is required.");
    }
    const existingRecord = await this.getRefreshTokenRecord(rawRefreshToken);
    if (!existingRecord || existingRecord.revokedAt) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is revoked.");
    }
    if (new Date(existingRecord.expiresAt) <= now) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is expired.");
    }
    if (command.appId && command.appId !== existingRecord.appId) {
      forbidden(
        "AUTH_APP_SCOPE_MISMATCH",
        "Refresh token app scope does not match the request.",
      );
    }
    if (!await this.refreshTokenStore.claimRotation(existingRecord.tokenHash, existingRecord.expiresAt, now)) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is revoked.");
    }
    const user = await this.userService.getById(existingRecord.userId);
    await this.appRegistryService.getAppOrThrow(existingRecord.appId);
    await this.appRegistryService.ensureExistingMembership(
      existingRecord.appId,
      user.id,
    );
    const accessToken = this.tokenService.issueAccessToken(
      user.id,
      existingRecord.appId,
      await this.getAccessTokenVersion(user.id, existingRecord.appId),
      now,
    );
    const { rawToken: refreshToken, recordId } = await this.issueRefreshToken(
      user.id,
      existingRecord.appId,
      now,
    );
    existingRecord.revokedAt = now.toISOString();
    existingRecord.replacedBy = recordId;
    await this.refreshTokenStore.update(existingRecord);
    return {
      userId: user.id,
      appId: existingRecord.appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
  }

  async logout(
    command: LogoutCommand,
    auth: AuthContext,
    now = new Date(),
  ): Promise<number> {
    if (command.appId !== auth.appId) {
      forbidden(
        "AUTH_APP_SCOPE_MISMATCH",
        "Logout app scope does not match the access token.",
      );
    }
    if (command.scope === "all") {
      return await this.revokeAllSessions(auth.appId, auth.userId, now);
    }
    const rawRefreshToken = command.cookieRefreshToken ?? command.refreshToken;
    if (!rawRefreshToken) {
      unauthorized(
        "AUTH_REFRESH_TOKEN_REQUIRED",
        "Refresh token is required for current-device logout.",
      );
    }
    const record = await this.getRefreshTokenRecord(rawRefreshToken);
    if (
      !record ||
      record.revokedAt ||
      record.userId !== auth.userId ||
      record.appId !== auth.appId
    ) {
      unauthorized(
        "AUTH_REFRESH_TOKEN_REVOKED",
        "Refresh token is already invalid.",
      );
    }
    record.revokedAt = now.toISOString();
    await this.refreshTokenStore.update(record);
    return 1;
  }

  async deleteCurrentAppAccount(
    command: {
      appId: string;
      userId: string;
      confirmation: string;
    },
    now = new Date(),
  ): Promise<AccountDeletionResult> {
    if (command.confirmation !== "DELETE") {
      badRequest(
        "AUTH_ACCOUNT_DELETE_CONFIRMATION_INVALID",
        "Type DELETE to confirm account deletion.",
      );
    }
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    await this.userService.getById(command.userId);
    await this.appRegistryService.ensureExistingMembership(
      app.id,
      command.userId,
    );
    return await this.database.withExclusiveSession(async () => {
      await this.database.deleteAppUserRuntimeData(app.id, command.userId);
      await this.database.updateAppUserStatus(
        app.id,
        command.userId,
        "DELETED",
      );
      const revokedSessions = await this.revokeAllSessions(
        app.id,
        command.userId,
        now,
      );
      return {
        deleted: true,
        revokedSessions,
      };
    });
  }

  buildRefreshCookie(
    refreshToken: string,
    clientType: ClientType,
  ): string | undefined {
    if (clientType !== "web") {
      return undefined;
    }
    return this.buildRefreshCookieValue(
      `refreshToken=${encodeURIComponent(refreshToken)}`,
      `Max-Age=${Math.floor(this.refreshTokenTtlMs / 1000)}`,
    );
  }

  buildClearRefreshCookie(): string {
    return this.buildRefreshCookieValue("refreshToken=", "Max-Age=0");
  }

  async issueSession(
    userId: string,
    appId: string,
    now = new Date(),
  ): Promise<AuthSession> {
    const accessToken = this.tokenService.issueAccessToken(
      userId,
      appId,
      await this.getAccessTokenVersion(userId, appId),
      now,
    );
    const { rawToken: refreshToken } = await this.issueRefreshToken(
      userId,
      appId,
      now,
    );
    return {
      userId,
      appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
  }

  async assertAccessTokenActive(auth: AuthContext): Promise<void> {
    const currentVersion = await this.getAccessTokenVersion(
      auth.userId,
      auth.appId,
    );
    if (auth.tokenVersion !== currentVersion) {
      unauthorized(
        "AUTH_INVALID_TOKEN",
        "Bearer token is revoked or out of date.",
      );
    }
  }

  async revokeAllSessions(
    appId: string,
    userId: string,
    now = new Date(),
  ): Promise<number> {
    const revoked = await this.refreshTokenStore.revokeAllByUserAndApp(
      appId,
      userId,
      now.toISOString(),
    );
    await this.bumpAccessTokenVersion(userId, appId);
    return revoked;
  }

  async revokeIssuedSession(
    rawRefreshToken: string,
    now = new Date(),
  ): Promise<boolean> {
    const record = await this.getRefreshTokenRecord(rawRefreshToken);
    if (!record || record.revokedAt) {
      return false;
    }

    record.revokedAt = now.toISOString();
    await this.refreshTokenStore.update(record);
    return true;
  }

  private async issueRefreshToken(
    userId: string,
    appId: string,
    now = new Date(),
  ): Promise<{ rawToken: string; recordId: string }> {
    const rawToken = createOpaqueToken("rt");
    const recordId = randomId("rft");
    await this.refreshTokenStore.create({
      id: recordId,
      appId,
      userId,
      tokenHash: sha256(rawToken),
      expiresAt: new Date(now.getTime() + this.refreshTokenTtlMs).toISOString(),
      revokedAt: undefined,
      replacedBy: undefined,
    });
    return { rawToken, recordId };
  }

  private async getRefreshTokenRecord(rawToken: string) {
    return await this.refreshTokenStore.getByRawToken(rawToken);
  }

  private buildRefreshCookieValue(
    namePart: string,
    maxAgePart: string,
  ): string {
    const parts = [
      namePart,
      "HttpOnly",
      "Path=/api/v1/auth",
      `SameSite=${this.refreshCookieSameSite}`,
      maxAgePart,
    ];
    if (this.secureRefreshCookie) {
      parts.push("Secure");
    }
    return parts.join("; ");
  }

  private async getAccessTokenVersion(
    userId: string,
    appId: string,
  ): Promise<number> {
    const rawVersion = await this.kvManager.getString(
      this.accessTokenVersionScope,
      this.buildAccessTokenVersionKey(appId, userId),
    );
    const parsedVersion = rawVersion ? Number(rawVersion) : NaN;
    return Number.isInteger(parsedVersion) && parsedVersion > 0
      ? parsedVersion
      : 1;
  }

  private async bumpAccessTokenVersion(
    userId: string,
    appId: string,
  ): Promise<number> {
    const nextVersion = (await this.getAccessTokenVersion(userId, appId)) + 1;
    await this.kvManager.setString(
      this.accessTokenVersionScope,
      this.buildAccessTokenVersionKey(appId, userId),
      String(nextVersion),
    );
    return nextVersion;
  }

  private buildAccessTokenVersionKey(appId: string, userId: string): string {
    return `${appId}:${userId}`;
  }
}
