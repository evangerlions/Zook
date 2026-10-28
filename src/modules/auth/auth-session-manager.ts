import { assertSleepGuestActive } from "../frogsleep/guest/guest-access.ts";
import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import {
  ApplicationError,
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
  RefreshTokenRecord,
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
    prepareResponse?: (session: AuthSession) => Promise<void>,
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
    const credentialVersion = await this.getCredentialVersion(existingRecord.userId);
    if ((existingRecord.credentialVersion ?? 1) !== credentialVersion)
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is revoked.");
    const user = await this.userService.getById(existingRecord.userId);
    await assertSleepGuestActive(this.database,user,existingRecord.appId,now);
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
      credentialVersion,
    );
    const { rawToken: refreshToken, record } = this.prepareRefreshToken(user.id, existingRecord.appId, credentialVersion, now);
    const session = {
      userId: user.id,
      appId: existingRecord.appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
    try { await prepareResponse?.(session); }
    catch (error) {
      if (error instanceof ApplicationError && error.code === "AUTH_LOGIN_FORBIDDEN")
        await this.refreshTokenStore.rotate(existingRecord, { ...record, revokedAt: now.toISOString() }, now);
      throw error;
    }
    if (!await this.refreshTokenStore.rotate(existingRecord, record, now))
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is revoked.");
    return session;
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
    const operation = async () => await this.deleteAppAccountData(app.id, command.userId, now);
    if (app.id !== "frogsleep") return await operation();
    return await this.database.withFrogSleepBuddyCommandTransaction([
      { appId: app.id, userId: command.userId, domain: "focus" },
      { appId: app.id, userId: command.userId, domain: "sleep" },
    ], operation);
  }

  private async deleteAppAccountData(appId: string, userId: string, now: Date): Promise<AccountDeletionResult> {
    return await this.database.withAppUserDataTransaction(appId, userId, async () => {
      await this.database.deleteAppUserRuntimeData(appId, userId);
      await this.database.updateAppUserStatus(appId, userId, "DELETED");
      const revokedSessions = await this.revokeAllSessions(appId, userId, now);
      return { deleted: true, revokedSessions };
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
    const credentialVersion = await this.getCredentialVersion(userId);
    const accessToken = this.tokenService.issueAccessToken(
      userId,
      appId,
      await this.getAccessTokenVersion(userId, appId),
      now,
      credentialVersion,
    );
    const { rawToken: refreshToken } = await this.issueRefreshToken(
      userId,
      appId,
      now,
      credentialVersion,
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
    if ((auth.credentialVersion ?? 1) !== await this.getCredentialVersion(auth.userId))
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is revoked or out of date.");
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

  private async getCredentialVersion(userId: string): Promise<number> {
    return (await this.userService.getById(userId)).credentialVersion ?? 1;
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
    credentialVersion = 1,
  ): Promise<{ rawToken: string; recordId: string }> {
    const { rawToken, record } = this.prepareRefreshToken(userId, appId, credentialVersion, now);
    await this.refreshTokenStore.create(record);
    return { rawToken, recordId: record.id };
  }

  private prepareRefreshToken(userId: string, appId: string, credentialVersion: number, now: Date): { rawToken: string; record: RefreshTokenRecord } {
    const rawToken = createOpaqueToken("rt");
    return { rawToken, record: {
      id: randomId("rft"),
      appId,
      userId,
      tokenHash: sha256(rawToken),
      credentialVersion,
      expiresAt: new Date(now.getTime() + this.refreshTokenTtlMs).toISOString(),
      revokedAt: undefined,
      replacedBy: undefined,
    } };
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
