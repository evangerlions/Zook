import { InMemoryCache } from "../../infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryDatabase } from "../../infrastructure/database/prisma/in-memory-database.ts";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../shared/errors.ts";
import type {
  AuthContext,
  AuthSession,
  ClientType,
  EmailLoginCodeCommand,
  EmailLoginCommand,
  LoginCommand,
  LogoutCommand,
  RefreshCommand,
  RegisterCommand,
  RegisterEmailCodeCommand,
  RegisterEmailCodeResult,
} from "../../shared/types.ts";
import { createOpaqueToken, randomId, randomNumericCode, sha256, toDateKey, toHourKey } from "../../shared/utils.ts";
import { RefreshTokenStore } from "../../services/refresh-token-store.ts";
import type { RegistrationEmailSender } from "../../services/tencent-ses-registration-email.service.ts";
import { VERIFICATION_EMAIL_TEMPLATE_NAME } from "../../services/common-email-config.service.ts";
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
  private readonly refreshTokenTtlMs = 60 * 24 * 60 * 60 * 1000;
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
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly registrationEmailSender: RegistrationEmailSender,
    private readonly registrationCodeGenerator: () => string = () => randomNumericCode(6),
  ) {}

  async login(command: LoginCommand, now = new Date()): Promise<AuthSession> {
    const normalizedAccount = command.account.trim().toLowerCase();
    this.assertNotLocked(normalizedAccount, now);

    const user = this.database.findUserByAccount(normalizedAccount);
    if (!user || user.passwordAlgo !== "argon2id-adapter" || !this.passwordHasher.verify(command.password, user.passwordHash)) {
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

  async registerEmailCode(
    command: RegisterEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
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

    const entry = {
      codeHash: sha256(rawCode),
      expiresAt: new Date(now.getTime() + this.registrationCodeTtlMs).toISOString(),
      sentAt: now.toISOString(),
      failedAttempts: 0,
    } satisfies EmailVerificationCacheEntry;

    this.cache.set(
      cacheKey,
      entry,
      Math.ceil(this.registrationCodeTtlMs / 1000),
      now,
    );

    try {
      await this.registrationEmailSender.sendVerificationCode({
        appName: this.appRegistryService.resolveLocalizedAppName(app, {
          locale: command.locale,
          region: command.region,
        }),
        email,
        code: rawCode,
        locale: command.locale.trim() || "zh-CN",
        region: command.region,
        expireMinutes: Math.floor(this.registrationCodeTtlMs / (60 * 1000)),
        templateName: VERIFICATION_EMAIL_TEMPLATE_NAME,
      });
    } catch (error) {
      this.cache.delete(cacheKey);
      throw error;
    }

    return {
      accepted: true,
      cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
    };
  }

  async loginEmailCode(
    command: EmailLoginCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    this.consumeEmailLoginCodeLimits(app.id, email, ipAddress, now);

    const cacheKey = this.buildEmailLoginCodeKey(app.id, email);
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

    const entry = {
      codeHash: sha256(rawCode),
      expiresAt: new Date(now.getTime() + this.registrationCodeTtlMs).toISOString(),
      sentAt: now.toISOString(),
      failedAttempts: 0,
    } satisfies EmailVerificationCacheEntry;

    this.cache.set(
      cacheKey,
      entry,
      Math.ceil(this.registrationCodeTtlMs / 1000),
      now,
    );

    try {
      await this.registrationEmailSender.sendVerificationCode({
        appName: this.appRegistryService.resolveLocalizedAppName(app, {
          locale: command.locale,
          region: command.region,
        }),
        email,
        code: rawCode,
        locale: command.locale.trim() || "zh-CN",
        region: command.region,
        expireMinutes: Math.floor(this.registrationCodeTtlMs / (60 * 1000)),
        templateName: VERIFICATION_EMAIL_TEMPLATE_NAME,
      });
    } catch (error) {
      this.cache.delete(cacheKey);
      throw error;
    }

    return {
      accepted: true,
      cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
    };
  }

  async register(command: RegisterCommand, now = new Date()): Promise<AuthSession> {
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

  async loginWithEmailCode(
    command: EmailLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    this.consumeEmailLoginLimits(app.id, email, ipAddress, now);

    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized("AUTH_VERIFICATION_CODE_REQUIRED", "Email verification code is required.");
    }

    const cacheKey = this.buildEmailLoginCodeKey(app.id, email);
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

    this.cache.delete(cacheKey);

    let user = this.database.findUserByAccount(email);
    let autoCreatedUser = false;
    if (!user) {
      if (app.joinMode !== "AUTO") {
        forbidden("APP_JOIN_INVITE_REQUIRED", "This app requires an invite to join.");
      }

      autoCreatedUser = true;
      user = {
        id: randomId("user"),
        email,
        passwordHash: this.passwordHasher.hash(createOpaqueToken("pwd")),
        passwordAlgo: "email-code-only",
        status: "ACTIVE",
        createdAt: now.toISOString(),
      };
      this.database.users.push(user);
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    this.appRegistryService.ensureMembership(app.id, user.id, now);

    return {
      session: await this.issueSessionForUser(user.id, app.id, now),
      autoCreatedUser,
    };
  }

  async refresh(command: RefreshCommand, now = new Date()): Promise<AuthSession> {
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
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Refresh token app scope does not match the request.");
    }

    const user = this.userService.getById(existingRecord.userId);
    this.appRegistryService.getAppOrThrow(existingRecord.appId);
    this.appRegistryService.ensureExistingMembership(existingRecord.appId, user.id);

    const accessToken = this.tokenService.issueAccessToken(user.id, existingRecord.appId, now);
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

  async logout(command: LogoutCommand, auth: AuthContext, now = new Date()): Promise<number> {
    if (command.appId !== auth.appId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Logout app scope does not match the access token.");
    }

    if (command.scope === "all") {
      return this.refreshTokenStore.revokeAllByUserAndApp(auth.appId, auth.userId, now.toISOString());
    }

    const rawRefreshToken = command.cookieRefreshToken ?? command.refreshToken;
    if (!rawRefreshToken) {
      unauthorized("AUTH_REFRESH_TOKEN_REQUIRED", "Refresh token is required for current-device logout.");
    }

    const record = await this.getRefreshTokenRecord(rawRefreshToken);
    if (!record || record.revokedAt || record.userId !== auth.userId || record.appId !== auth.appId) {
      unauthorized("AUTH_REFRESH_TOKEN_REVOKED", "Refresh token is already invalid.");
    }

    record.revokedAt = now.toISOString();
    await this.refreshTokenStore.update(record);
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

  async issueSession(userId: string, appId: string, now = new Date()): Promise<AuthSession> {
    return this.issueSessionForUser(userId, appId, now);
  }

  private async issueSessionForUser(userId: string, appId: string, now = new Date()): Promise<AuthSession> {
    const accessToken = this.tokenService.issueAccessToken(userId, appId, now);
    const { rawToken: refreshToken } = await this.issueRefreshToken(userId, appId, now);

    return {
      userId,
      appId,
      accessToken,
      refreshToken,
      expiresIn: this.tokenService.expiresInSeconds,
    };
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
    return this.refreshTokenStore.getByRawToken(rawToken);
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

  private consumeEmailLoginCodeLimits(appId: string, email: string, ipAddress: string, now = new Date()): void {
    this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("email-code", appId, email, ipAddress),
      this.registrationCodeWindowMs,
      this.registrationCodeWindowLimit,
      now,
    );
    this.consumeBucketCount(
      this.buildEmailLoginEmailDayRateKey(email, now),
      48 * 60 * 60,
      this.registrationEmailDailyLimit,
      now,
    );
    this.consumeBucketCount(
      this.buildEmailLoginIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      this.registrationIpHourlyLimit,
      now,
    );
  }

  private consumeEmailLoginLimits(appId: string, email: string, ipAddress: string, now = new Date()): void {
    this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("complete", appId, email, ipAddress),
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

  private buildEmailLoginCodeKey(appId: string, email: string): string {
    return `auth:email-login:code:${appId}:${email}`;
  }

  private buildEmailLoginComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    email: string,
    ipAddress: string,
  ): string {
    return `auth:email-login:rate:${kind}:${appId}:${email}:${ipAddress}`;
  }

  private buildEmailLoginEmailDayRateKey(email: string, now = new Date()): string {
    return `auth:email-login:email-day:${toDateKey(now)}:${email}`;
  }

  private buildEmailLoginIpHourRateKey(ipAddress: string, now = new Date()): string {
    return `auth:email-login:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }
}
