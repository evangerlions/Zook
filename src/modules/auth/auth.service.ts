import { InMemoryCache } from "../../infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../shared/errors.ts";
import type {
  AuthContext,
  AuthSession,
  ClientType,
  LoginCommand,
  LogoutCommand,
  RefreshCommand,
  RegisterCommand,
  RegisterEmailCodeCommand,
  RegisterEmailCodeResult,
} from "../../shared/types.ts";
import { createOpaqueToken, randomId, randomNumericCode, sha256, toDateKey, toHourKey } from "../../shared/utils.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { UserService } from "../user/user.service.ts";
import { DevelopmentPasswordHasher } from "./password-hasher.ts";
import { TokenService } from "./token.service.ts";

interface LoginFailureState {
  count: number;
  windowStartedAt: number;
  lockedUntil?: number;
}

interface EmailVerificationCacheEntry {
  codeHash: string;
  expiresAt: string;
  sentAt: string;
  failedAttempts: number;
}

/**
 * AuthService implements the document's shared-account, password-only, bearer-only auth workflow.
 */
export class AuthService {
  private readonly refreshTokenTtlMs = 30 * 24 * 60 * 60 * 1000;
  private readonly failureWindowMs = 15 * 60 * 1000;
  private readonly maxFailedAttempts = 10;
  private readonly lockDurationMs = 15 * 60 * 1000;
  private readonly registrationCodeTtlMs = 10 * 60 * 1000;
  private readonly registrationResendCooldownMs = 60 * 1000;
  private readonly registrationEmailDailyLimit = 5;
  private readonly registrationIpHourlyLimit = 20;
  private readonly registrationCodeWindowMs = 10 * 60 * 1000;
  private readonly registrationCodeWindowLimit = 3;
  private readonly registrationWindowMs = 10 * 60 * 1000;
  private readonly registrationWindowLimit = 5;
  private readonly registrationMaxFailedCodeAttempts = 5;
  private readonly failureStates = new Map<string, LoginFailureState>();

  constructor(
    private readonly database: InMemoryDatabase,
    private readonly cache: InMemoryCache,
    private readonly userService: UserService,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly tokenService: TokenService,
    private readonly registrationCodeGenerator: () => string = () => randomNumericCode(6),
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

    return this.issueSessionForUser(user.id, app.id, now);
  }

  registerEmailCode(
    command: RegisterEmailCodeCommand,
    now = new Date(),
  ): RegisterEmailCodeResult {
    const app = this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    this.consumeRegistrationCodeLimits(app.id, email, ipAddress, now);

    const cacheKey = this.buildRegistrationCodeKey(app.id, email);
    const existingCode = this.cache.get<EmailVerificationCacheEntry>(cacheKey, now);
    if (
      existingCode &&
      now.getTime() - new Date(existingCode.sentAt).getTime() < this.registrationResendCooldownMs
    ) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    const rawCode = this.registrationCodeGenerator();
    if (!/^\d{6}$/.test(rawCode)) {
      throw new Error("Registration code generator must return a 6-digit numeric string.");
    }

    this.cache.set(
      cacheKey,
      {
        codeHash: sha256(rawCode),
        expiresAt: new Date(now.getTime() + this.registrationCodeTtlMs).toISOString(),
        sentAt: now.toISOString(),
        failedAttempts: 0,
      } satisfies EmailVerificationCacheEntry,
      Math.ceil(this.registrationCodeTtlMs / 1000),
      now,
    );

    return {
      accepted: true,
      cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
    };
  }

  register(command: RegisterCommand, now = new Date()): AuthSession {
    const app = this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    this.consumeRegistrationLimits(app.id, email, ipAddress, now);

    if (!this.passwordHasher.validateStrength(command.password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be at least 10 characters and include both letters and numbers.",
      );
    }

    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized("AUTH_VERIFICATION_CODE_REQUIRED", "Email verification code is required.");
    }

    const cacheKey = this.buildRegistrationCodeKey(app.id, email);
    const cachedCode = this.cache.get<EmailVerificationCacheEntry>(cacheKey, now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= now) {
      this.cache.delete(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (cachedCode.failedAttempts >= this.registrationMaxFailedCodeAttempts) {
      this.cache.delete(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (sha256(emailCode) !== cachedCode.codeHash) {
      this.recordFailedCodeAttempt(cacheKey, cachedCode, now);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (this.database.findUserByAccount(email)) {
      conflict("AUTH_ACCOUNT_ALREADY_EXISTS", "Registration is not available for the provided email.");
    }

    this.cache.delete(cacheKey);

    const userId = randomId("user");
    this.database.users.push({
      id: userId,
      email,
      passwordHash: this.passwordHasher.hash(command.password),
      passwordAlgo: "argon2id-adapter",
      status: "ACTIVE",
      createdAt: now.toISOString(),
    });
    this.appRegistryService.ensureMembership(app.id, userId, now);

    return this.issueSessionForUser(userId, app.id, now);
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

  issueSession(userId: string, appId: string, now = new Date()): AuthSession {
    return this.issueSessionForUser(userId, appId, now);
  }

  private issueSessionForUser(userId: string, appId: string, now = new Date()): AuthSession {
    const accessToken = this.tokenService.issueAccessToken(userId, appId, now);
    const { rawToken: refreshToken } = this.issueRefreshToken(userId, appId, now);

    return {
      userId,
      appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
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

  private assertSelfRegistrationAllowed(appId: string) {
    const app = this.appRegistryService.getAppOrThrow(appId);
    if (app.joinMode !== "AUTO") {
      forbidden("APP_JOIN_INVITE_REQUIRED", "This app requires an invite to join.");
    }

    return app;
  }

  private normalizeEmail(email: string): string {
    const normalized = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      badRequest("REQ_INVALID_BODY", "email must be a valid email address.");
    }

    return normalized;
  }

  private normalizeIpAddress(ipAddress?: string): string {
    const normalized = ipAddress?.trim();
    return normalized ? normalized : "unknown";
  }

  private consumeRegistrationCodeLimits(appId: string, email: string, ipAddress: string, now = new Date()): void {
    this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("email-code", appId, email, ipAddress),
      this.registrationCodeWindowMs,
      this.registrationCodeWindowLimit,
      now,
    );
    this.consumeBucketCount(
      this.buildRegistrationEmailDayRateKey(email, now),
      48 * 60 * 60,
      this.registrationEmailDailyLimit,
      now,
    );
    this.consumeBucketCount(
      this.buildRegistrationIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      this.registrationIpHourlyLimit,
      now,
    );
  }

  private consumeRegistrationLimits(appId: string, email: string, ipAddress: string, now = new Date()): void {
    this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("complete", appId, email, ipAddress),
      this.registrationWindowMs,
      this.registrationWindowLimit,
      now,
    );
  }

  private consumeRollingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now = new Date(),
  ): void {
    const currentWindow = (this.cache.get<number[]>(key, now) ?? []).filter(
      (timestamp) => now.getTime() - timestamp < windowMs,
    );

    if (currentWindow.length >= limit) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    currentWindow.push(now.getTime());
    this.cache.set(key, currentWindow, Math.ceil(windowMs / 1000), now);
  }

  private consumeBucketCount(key: string, ttlSeconds: number, limit: number, now = new Date()): void {
    const current = this.cache.get<number>(key, now) ?? 0;
    if (current >= limit) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    this.cache.set(key, current + 1, ttlSeconds, now);
  }

  private recordFailedCodeAttempt(
    cacheKey: string,
    cachedCode: EmailVerificationCacheEntry,
    now = new Date(),
  ): void {
    const nextFailedAttempts = cachedCode.failedAttempts + 1;
    if (nextFailedAttempts >= this.registrationMaxFailedCodeAttempts) {
      this.cache.delete(cacheKey);
      return;
    }

    const remainingMs = new Date(cachedCode.expiresAt).getTime() - now.getTime();
    if (remainingMs <= 0) {
      this.cache.delete(cacheKey);
      return;
    }

    this.cache.set(
      cacheKey,
      {
        ...cachedCode,
        failedAttempts: nextFailedAttempts,
      } satisfies EmailVerificationCacheEntry,
      Math.ceil(remainingMs / 1000),
      now,
    );
  }

  private buildRegistrationCodeKey(appId: string, email: string): string {
    return `auth:register:code:${appId}:${email}`;
  }

  private buildRegistrationComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    email: string,
    ipAddress: string,
  ): string {
    return `auth:register:rate:${kind}:${appId}:${email}:${ipAddress}`;
  }

  private buildRegistrationEmailDayRateKey(email: string, now = new Date()): string {
    return `auth:register:email-day:${toDateKey(now)}:${email}`;
  }

  private buildRegistrationIpHourRateKey(ipAddress: string, now = new Date()): string {
    return `auth:register:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }
}
