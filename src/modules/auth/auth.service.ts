import { forbidden, unauthorized } from "../../shared/errors.ts";
import type { AuthContext, AuthSession, ClientType, LoginCommand, LogoutCommand, RefreshCommand } from "../../shared/types.ts";
import { createOpaqueToken, randomId, sha256 } from "../../shared/utils.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { UserService } from "../user/user.service.ts";
import { DevelopmentPasswordHasher } from "./password-hasher.ts";
import { TokenService } from "./token.service.ts";

interface LoginFailureState {
  count: number;
  windowStartedAt: number;
  lockedUntil?: number;
}

/**
 * AuthService implements the document's shared-account, password-only, bearer-only auth workflow.
 */
export class AuthService {
  private readonly refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;
  private readonly failureWindowMs = 15 * 60 * 1000;
  private readonly maxFailedAttempts = 10;
  private readonly lockDurationMs = 15 * 60 * 1000;
  private readonly failureStates = new Map<string, LoginFailureState>();

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly userService: UserService,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly tokenService: TokenService,
  ) {}

  login(command: LoginCommand, now = new Date()): AuthSession {
    const normalizedAccount = command.account.trim().toLowerCase();
    this.assertNotLocked(normalizedAccount, now);

    const user = this.database.findUserByAccount(normalizedAccount);
    if (!user || !this.passwordHasher.verify(command.password, user.passwordHash)) {
      this.registerFailure(normalizedAccount, now);
      unauthorized("AUTH_INVALID_CREDENTIAL", "Account or password is invalid.");
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    this.failureStates.delete(normalizedAccount);
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    this.appRegistryService.ensureMembership(app.id, user.id, now);

    const accessToken = this.tokenService.issueAccessToken(user.id, app.id, now);
    const { rawToken: refreshToken } = this.issueRefreshToken(user.id, app.id, now);

    return {
      userId: user.id,
      appId: app.id,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
  }

  refresh(command: RefreshCommand, now = new Date()): AuthSession {
    const rawRefreshToken = command.cookieRefreshToken ?? command.refreshToken;
    if (!rawRefreshToken) {
      unauthorized("AUTH_REFRESH_TOKEN_REQUIRED", "Refresh token is required.");
    }

    const existingRecord = this.getRefreshTokenRecord(rawRefreshToken);
    if (!existingRecord || existingRecord.revokedAt) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is revoked.");
    }

    if (new Date(existingRecord.expiresAt) <= now) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is expired.");
    }

    if (command.appId && command.appId !== existingRecord.appId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Refresh token app scope does not match the request.");
    }

    const user = this.userService.getById(existingRecord.userId);
    this.appRegistryService.getAppOrThrow(existingRecord.appId);
    this.appRegistryService.ensureExistingMembership(existingRecord.appId, user.id);

    const accessToken = this.tokenService.issueAccessToken(user.id, existingRecord.appId, now);
    const { rawToken: refreshToken, recordId } = this.issueRefreshToken(
      user.id,
      existingRecord.appId,
      now,
    );
    existingRecord.revokedAt = now.toISOString();
    existingRecord.replacedBy = recordId;

    return {
      userId: user.id,
      appId: existingRecord.appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
  }

  logout(command: LogoutCommand, auth: AuthContext, now = new Date()): number {
    if (command.appId !== auth.appId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Logout app scope does not match the access token.");
    }

    if (command.scope === "all") {
      const records = this.database.refreshTokens.filter(
        (item) => item.appId === auth.appId && item.userId === auth.userId && !item.revokedAt,
      );

      records.forEach((item) => {
        item.revokedAt = now.toISOString();
      });
      return records.length;
    }

    const rawRefreshToken = command.cookieRefreshToken ?? command.refreshToken;
    if (!rawRefreshToken) {
      unauthorized("AUTH_REFRESH_TOKEN_REQUIRED", "Refresh token is required for current-device logout.");
    }

    const record = this.getRefreshTokenRecord(rawRefreshToken);
    if (!record || record.revokedAt || record.userId !== auth.userId || record.appId !== auth.appId) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is already invalid.");
    }

    record.revokedAt = now.toISOString();
    return 1;
  }

  buildRefreshCookie(refreshToken: string, clientType: ClientType): string | undefined {
    if (clientType !== "web") {
      return undefined;
    }

    return `refreshToken=${encodeURIComponent(
      refreshToken,
    )}; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=${Math.floor(
      this.refreshTokenTtlMs / 1000,
    )}`;
  }

  private issueRefreshToken(
    userId: string,
    appId: string,
    now = new Date(),
  ): { rawToken: string; recordId: string } {
    const rawToken = createOpaqueToken("rt");
    const recordId = randomId("rft");
    this.database.refreshTokens.push({
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

  private getRefreshTokenRecord(rawToken: string) {
    const tokenHash = sha256(rawToken);
    return this.database.refreshTokens.find((item) => item.tokenHash === tokenHash);
  }

  private assertNotLocked(account: string, now = new Date()): void {
    const state = this.failureStates.get(account);
    if (!state?.lockedUntil) {
      return;
    }

    if (state.lockedUntil > now.getTime()) {
      forbidden(
        "AUTH_LOGIN_TEMPORARILY_LOCKED",
        "Too many failed logins. Please retry after the lock window.",
      );
    }

    this.failureStates.delete(account);
  }

  private registerFailure(account: string, now = new Date()): void {
    const previous = this.failureStates.get(account);
    const currentTime = now.getTime();

    if (!previous || currentTime - previous.windowStartedAt > this.failureWindowMs) {
      this.failureStates.set(account, {
        count: 1,
        windowStartedAt: currentTime,
      });
      return;
    }

    const nextState: LoginFailureState = {
      count: previous.count + 1,
      windowStartedAt: previous.windowStartedAt,
      lockedUntil: previous.lockedUntil,
    };

    if (nextState.count >= this.maxFailedAttempts) {
      nextState.lockedUntil = currentTime + this.lockDurationMs;
      nextState.count = 0;
      nextState.windowStartedAt = currentTime;
    }

    this.failureStates.set(account, nextState);
  }
}
