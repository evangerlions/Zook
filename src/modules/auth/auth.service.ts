import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import { badRequest, conflict, forbidden, tooManyRequests, unauthorized } from "../../shared/errors.ts";
import type {
  AuthContext,
  AuthSession,
  ChangePasswordCommand,
  ClientType,
  EmailLoginCodeCommand,
  EmailLoginCommand,
  LoginCommand,
  LogoutCommand,
  PasswordEmailCodeCommand,
  RefreshCommand,
  RegisterCommand,
  RegisterEmailCodeCommand,
  RegisterEmailCodeResult,
  ResetPasswordCommand,
  UserRecord,
} from "../../shared/types.ts";
import { createOpaqueToken, randomId, randomNumericCode, sha256, timingSafeHexCompare, toDateKey, toHourKey } from "../../shared/utils.ts";
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
  private readonly loginFailureScope = "auth.login-failures";
  private readonly verificationCodeScope = "auth.verification-codes";
  private readonly rateLimitScope = "auth.rate-limits";
  private readonly accessTokenVersionScope = "auth.access-token-versions";
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

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
    private readonly userService: UserService,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly tokenService: TokenService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly registrationEmailSender: RegistrationEmailSender,
    private readonly registrationCodeGenerator: () => string = () => randomNumericCode(6),
    private readonly secureRefreshCookie = false,
    private readonly refreshCookieSameSite: "Lax" | "None" | "Strict" = "Lax",
  ) {}

  async login(command: LoginCommand, now = new Date()): Promise<AuthSession> {
    const normalizedAccount = command.account.trim().toLowerCase();
    await this.assertNotLocked(normalizedAccount, now);

    const user = await this.database.findUserByAccount(normalizedAccount);
    if (!user || !this.verifyPassword(user, command.password)) {
      await this.registerFailure(normalizedAccount, now);
      unauthorized("AUTH_INVALID_CREDENTIAL", "Account or password is invalid.");
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    await this.clearFailureState(normalizedAccount);
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    await this.appRegistryService.ensureMembership(app.id, user.id, now);

    return this.issueSessionForUser(user.id, app.id, now);
  }

  async registerEmailCode(
    command: RegisterEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumeRegistrationCodeLimits(app.id, email, ipAddress, now);

    const cacheKey = this.buildRegistrationCodeKey(app.id, email);
    const existingCode = await this.getVerificationCodeEntry(cacheKey, now);
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

    await this.setVerificationCodeEntry(cacheKey, entry, this.registrationCodeTtlMs, now);

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
      await this.deleteVerificationCodeEntry(cacheKey);
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
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumeEmailLoginCodeLimits(app.id, email, ipAddress, now);

    const cacheKey = this.buildEmailLoginCodeKey(app.id, email);
    const existingCode = await this.getVerificationCodeEntry(cacheKey, now);
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

    await this.setVerificationCodeEntry(cacheKey, entry, this.registrationCodeTtlMs, now);

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
      await this.deleteVerificationCodeEntry(cacheKey);
      throw error;
    }

    return {
      accepted: true,
      cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
    };
  }

  async register(command: RegisterCommand, now = new Date()): Promise<AuthSession> {
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumeRegistrationLimits(app.id, email, ipAddress, now);

    if (!this.passwordHasher.validateStrength(command.password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be between 10 and 256 characters and include both letters and numbers.",
      );
    }

    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized("AUTH_VERIFICATION_CODE_REQUIRED", "Email verification code is required.");
    }

    const cacheKey = this.buildRegistrationCodeKey(app.id, email);
    const cachedCode = await this.getVerificationCodeEntry(cacheKey, now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= now) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (cachedCode.failedAttempts >= this.registrationMaxFailedCodeAttempts) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (!timingSafeHexCompare(sha256(emailCode), cachedCode.codeHash)) {
      await this.recordFailedCodeAttempt(cacheKey, cachedCode, now);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (await this.database.findUserByAccount(email)) {
      conflict("AUTH_ACCOUNT_ALREADY_EXISTS", "Registration is not available for the provided email.");
    }

    await this.deleteVerificationCodeEntry(cacheKey);

    const userId = randomId("user");
    await this.database.insertUser({
      id: userId,
      email,
      passwordHash: this.passwordHasher.hash(command.password),
      passwordAlgo: this.passwordHasher.algorithm,
      status: "ACTIVE",
      createdAt: now.toISOString(),
    });
    await this.appRegistryService.ensureMembership(app.id, userId, now);

    return this.issueSessionForUser(userId, app.id, now);
  }

  async loginWithEmailCode(
    command: EmailLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumeEmailLoginLimits(app.id, email, ipAddress, now);

    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized("AUTH_VERIFICATION_CODE_REQUIRED", "Email verification code is required.");
    }

    const cacheKey = this.buildEmailLoginCodeKey(app.id, email);
    const cachedCode = await this.getVerificationCodeEntry(cacheKey, now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= now) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (cachedCode.failedAttempts >= this.registrationMaxFailedCodeAttempts) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (!timingSafeHexCompare(sha256(emailCode), cachedCode.codeHash)) {
      await this.recordFailedCodeAttempt(cacheKey, cachedCode, now);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    await this.deleteVerificationCodeEntry(cacheKey);

    let user = await this.database.findUserByAccount(email);
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
      await this.database.insertUser(user);
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    await this.appRegistryService.ensureMembership(app.id, user.id, now);

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

    const user = await this.userService.getById(existingRecord.userId);
    await this.appRegistryService.getAppOrThrow(existingRecord.appId);
    await this.appRegistryService.ensureExistingMembership(existingRecord.appId, user.id);

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

  async logout(command: LogoutCommand, auth: AuthContext, now = new Date()): Promise<number> {
    if (command.appId !== auth.appId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "Logout app scope does not match the access token.");
    }

    if (command.scope === "all") {
      return this.revokeAllSessions(auth.appId, auth.userId, now);
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

    return this.buildRefreshCookieValue(
      `refreshToken=${encodeURIComponent(refreshToken)}`,
      `Max-Age=${Math.floor(this.refreshTokenTtlMs / 1000)}`,
    );
  }

  buildClearRefreshCookie(): string {
    return this.buildRefreshCookieValue("refreshToken=", "Max-Age=0");
  }

  async issueSession(userId: string, appId: string, now = new Date()): Promise<AuthSession> {
    return this.issueSessionForUser(userId, appId, now);
  }

  async sendPasswordCode(command: PasswordEmailCodeCommand, now = new Date()): Promise<RegisterEmailCodeResult> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumePasswordCodeLimits(app.id, email, ipAddress, now);

    const cacheKey = this.buildPasswordResetCodeKey(app.id, email);
    const existingCode = await this.getVerificationCodeEntry(cacheKey, now);
    if (
      existingCode &&
      now.getTime() - new Date(existingCode.sentAt).getTime() < this.registrationResendCooldownMs
    ) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    const user = await this.database.findUserByAccount(email);
    if (!user || user.status === "BLOCKED" || !(await this.canUsePasswordEmailFlow(app.id, user.id))) {
      return {
        accepted: true,
        cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
        expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
      };
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

    await this.setVerificationCodeEntry(cacheKey, entry, this.registrationCodeTtlMs, now);

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
      await this.deleteVerificationCodeEntry(cacheKey);
      throw error;
    }

    return {
      accepted: true,
      cooldownSeconds: Math.floor(this.registrationResendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.registrationCodeTtlMs / 1000),
    };
  }

  async resetPassword(command: ResetPasswordCommand, now = new Date()): Promise<AuthSession> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);

    await this.consumePasswordResetLimits(app.id, email, ipAddress, now);

    if (!this.passwordHasher.validateStrength(command.password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be between 10 and 256 characters and include both letters and numbers.",
      );
    }

    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized("AUTH_VERIFICATION_CODE_REQUIRED", "Email verification code is required.");
    }

    const cacheKey = this.buildPasswordResetCodeKey(app.id, email);
    const cachedCode = await this.getVerificationCodeEntry(cacheKey, now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= now) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (cachedCode.failedAttempts >= this.registrationMaxFailedCodeAttempts) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    if (!timingSafeHexCompare(sha256(emailCode), cachedCode.codeHash)) {
      await this.recordFailedCodeAttempt(cacheKey, cachedCode, now);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    const user = await this.database.findUserByAccount(email);
    if (!user || user.status === "BLOCKED" || !(await this.canUsePasswordEmailFlow(app.id, user.id))) {
      await this.deleteVerificationCodeEntry(cacheKey);
      unauthorized("AUTH_VERIFICATION_CODE_INVALID", "Email verification code is invalid or expired.");
    }

    await this.deleteVerificationCodeEntry(cacheKey);
    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.password),
      this.passwordHasher.algorithm,
    );

    await this.revokeAllSessions(app.id, user.id, now);
    await this.appRegistryService.ensureMembership(app.id, user.id, now);
    return this.issueSessionForUser(user.id, app.id, now);
  }

  async changePassword(command: ChangePasswordCommand, now = new Date()): Promise<AuthSession> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const user = await this.userService.getById(command.userId);
    await this.appRegistryService.ensureExistingMembership(app.id, user.id);

    if (!this.passwordHasher.validateStrength(command.newPassword)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be between 10 and 256 characters and include both letters and numbers.",
      );
    }

    if (!this.canVerifyPassword(user)) {
      badRequest(
        "REQ_INVALID_BODY",
        "This account does not have a password yet. Use the password reset flow instead.",
      );
    }

    if (!this.verifyPassword(user, command.currentPassword)) {
      unauthorized("AUTH_INVALID_CREDENTIAL", "Account or password is invalid.");
    }

    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.newPassword),
      this.passwordHasher.algorithm,
    );
    await this.revokeAllSessions(app.id, user.id, now);

    return this.issueSessionForUser(user.id, app.id, now);
  }

  async assertAccessTokenActive(auth: AuthContext): Promise<void> {
    const currentVersion = await this.getAccessTokenVersion(auth.userId, auth.appId);
    if (auth.tokenVersion !== currentVersion) {
      unauthorized("AUTH_INVALID_TOKEN", "Bearer token is revoked or out of date.");
    }
  }

  private async issueSessionForUser(userId: string, appId: string, now = new Date()): Promise<AuthSession> {
    const accessToken = this.tokenService.issueAccessToken(
      userId,
      appId,
      await this.getAccessTokenVersion(userId, appId),
      now,
    );
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

  private async assertNotLocked(account: string, now = new Date()): Promise<void> {
    const state = await this.getFailureState(account);
    if (!state?.lockedUntil) {
      return;
    }

    if (state.lockedUntil > now.getTime()) {
      forbidden(
        "AUTH_LOGIN_TEMPORARILY_LOCKED",
        "Too many failed logins. Please retry after the lock window.",
      );
    }

    await this.clearFailureState(account);
  }

  private async registerFailure(account: string, now = new Date()): Promise<void> {
    const previous = await this.getFailureState(account);
    const currentTime = now.getTime();

    if (!previous || currentTime - previous.windowStartedAt > this.failureWindowMs) {
      await this.setFailureState(account, {
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

    await this.setFailureState(account, nextState);
  }

  private async getFailureState(account: string): Promise<LoginFailureState | undefined> {
    return this.kvManager.getJson<LoginFailureState>(this.loginFailureScope, this.buildFailureKey(account));
  }

  private async setFailureState(account: string, state: LoginFailureState): Promise<void> {
    await this.kvManager.setJson(this.loginFailureScope, this.buildFailureKey(account), state);
  }

  private async clearFailureState(account: string): Promise<void> {
    await this.kvManager.delete(this.loginFailureScope, this.buildFailureKey(account));
  }

  private buildFailureKey(account: string): string {
    return sha256(account.trim().toLowerCase());
  }

  private buildRefreshCookieValue(namePart: string, maxAgePart: string): string {
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

  private canVerifyPassword(user: UserRecord): boolean {
    return user.passwordAlgo === this.passwordHasher.algorithm || user.passwordAlgo === "argon2id-adapter";
  }

  private verifyPassword(user: UserRecord, password: string): boolean {
    return this.canVerifyPassword(user) && this.passwordHasher.verify(password, user.passwordHash);
  }

  private async canUsePasswordEmailFlow(appId: string, userId: string): Promise<boolean> {
    const membership = await this.database.findAppUser(appId, userId);
    if (membership) {
      return membership.status === "ACTIVE";
    }

    return (await this.appRegistryService.getAppOrThrow(appId)).joinMode === "AUTO";
  }

  private async assertSelfRegistrationAllowed(appId: string) {
    const app = await this.appRegistryService.getAppOrThrow(appId);
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

  private async consumeRegistrationCodeLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("email-code", appId, email, ipAddress),
      this.registrationCodeWindowMs,
      this.registrationCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildRegistrationEmailDayRateKey(email, now),
      48 * 60 * 60,
      this.registrationEmailDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildRegistrationIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      this.registrationIpHourlyLimit,
      now,
    );
  }

  private async consumeRegistrationLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildRegistrationComboRateKey("complete", appId, email, ipAddress),
      this.registrationWindowMs,
      this.registrationWindowLimit,
      now,
    );
  }

  private async consumeEmailLoginCodeLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("email-code", appId, email, ipAddress),
      this.registrationCodeWindowMs,
      this.registrationCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildEmailLoginEmailDayRateKey(email, now),
      48 * 60 * 60,
      this.registrationEmailDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildEmailLoginIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      this.registrationIpHourlyLimit,
      now,
    );
  }

  private async consumeEmailLoginLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildEmailLoginComboRateKey("complete", appId, email, ipAddress),
      this.registrationWindowMs,
      this.registrationWindowLimit,
      now,
    );
  }

  private async consumePasswordCodeLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildPasswordResetComboRateKey("email-code", appId, email, ipAddress),
      this.registrationCodeWindowMs,
      this.registrationCodeWindowLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildPasswordResetEmailDayRateKey(email, now),
      48 * 60 * 60,
      this.registrationEmailDailyLimit,
      now,
    );
    await this.consumeBucketCount(
      this.buildPasswordResetIpHourRateKey(ipAddress, now),
      2 * 60 * 60,
      this.registrationIpHourlyLimit,
      now,
    );
  }

  private async consumePasswordResetLimits(appId: string, email: string, ipAddress: string, now = new Date()): Promise<void> {
    await this.consumeRollingWindow(
      this.buildPasswordResetComboRateKey("complete", appId, email, ipAddress),
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
  ): Promise<void> {
    return this.consumeStoredRollingWindow(key, windowMs, limit, now);
  }

  private async consumeStoredRollingWindow(
    key: string,
    windowMs: number,
    limit: number,
    now = new Date(),
  ): Promise<void> {
    const currentWindow = ((await this.kvManager.getJson<number[]>(this.rateLimitScope, key)) ?? []).filter(
      (timestamp) => now.getTime() - timestamp < windowMs,
    );

    if (currentWindow.length >= limit) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    currentWindow.push(now.getTime());
    await this.kvManager.setJson(this.rateLimitScope, key, currentWindow, Math.ceil(windowMs / 1000));
  }

  private async consumeBucketCount(key: string, ttlSeconds: number, limit: number, now = new Date()): Promise<void> {
    const current = (await this.kvManager.getJson<number>(this.rateLimitScope, key)) ?? 0;
    if (current >= limit) {
      tooManyRequests("AUTH_RATE_LIMITED", "Request rate is too high. Please retry later.");
    }

    await this.kvManager.setJson(this.rateLimitScope, key, current + 1, ttlSeconds);
  }

  private async recordFailedCodeAttempt(
    cacheKey: string,
    cachedCode: EmailVerificationCacheEntry,
    now = new Date(),
  ): Promise<void> {
    const nextFailedAttempts = cachedCode.failedAttempts + 1;
    if (nextFailedAttempts >= this.registrationMaxFailedCodeAttempts) {
      await this.deleteVerificationCodeEntry(cacheKey);
      return;
    }

    const remainingMs = new Date(cachedCode.expiresAt).getTime() - now.getTime();
    if (remainingMs <= 0) {
      await this.deleteVerificationCodeEntry(cacheKey);
      return;
    }

    await this.setVerificationCodeEntry(
      cacheKey,
      {
        ...cachedCode,
        failedAttempts: nextFailedAttempts,
      } satisfies EmailVerificationCacheEntry,
      remainingMs,
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

  private buildPasswordResetCodeKey(appId: string, email: string): string {
    return `auth:password-reset:code:${appId}:${email}`;
  }

  private buildPasswordResetComboRateKey(
    kind: "email-code" | "complete",
    appId: string,
    email: string,
    ipAddress: string,
  ): string {
    return `auth:password-reset:rate:${kind}:${appId}:${email}:${ipAddress}`;
  }

  private buildPasswordResetEmailDayRateKey(email: string, now = new Date()): string {
    return `auth:password-reset:email-day:${toDateKey(now)}:${email}`;
  }

  private buildPasswordResetIpHourRateKey(ipAddress: string, now = new Date()): string {
    return `auth:password-reset:ip-hour:${toHourKey(now)}:${ipAddress}`;
  }

  private async getVerificationCodeEntry(key: string, now = new Date()): Promise<EmailVerificationCacheEntry | undefined> {
    const entry = await this.kvManager.getJson<EmailVerificationCacheEntry>(this.verificationCodeScope, key);
    if (!entry) {
      return undefined;
    }

    if (new Date(entry.expiresAt) <= now) {
      await this.deleteVerificationCodeEntry(key);
      return undefined;
    }

    return entry;
  }

  private async setVerificationCodeEntry(
    key: string,
    entry: EmailVerificationCacheEntry,
    ttlMs: number,
    now = new Date(),
  ): Promise<void> {
    const ttlSeconds = Math.max(
      1,
      Math.ceil(Math.min(ttlMs, new Date(entry.expiresAt).getTime() - now.getTime()) / 1000),
    );
    await this.kvManager.setJson(this.verificationCodeScope, key, entry, ttlSeconds);
  }

  private async deleteVerificationCodeEntry(key: string): Promise<void> {
    await this.kvManager.delete(this.verificationCodeScope, key);
  }

  private async getAccessTokenVersion(userId: string, appId: string): Promise<number> {
    const rawVersion = await this.kvManager.getString(
      this.accessTokenVersionScope,
      this.buildAccessTokenVersionKey(appId, userId),
    );
    const parsedVersion = rawVersion ? Number(rawVersion) : NaN;
    return Number.isInteger(parsedVersion) && parsedVersion > 0 ? parsedVersion : 1;
  }

  private async bumpAccessTokenVersion(userId: string, appId: string): Promise<number> {
    const nextVersion = (await this.getAccessTokenVersion(userId, appId)) + 1;
    await this.kvManager.setString(
      this.accessTokenVersionScope,
      this.buildAccessTokenVersionKey(appId, userId),
      String(nextVersion),
    );
    return nextVersion;
  }

  private async revokeAllSessions(appId: string, userId: string, now = new Date()): Promise<number> {
    const revoked = await this.refreshTokenStore.revokeAllByUserAndApp(appId, userId, now.toISOString());
    await this.bumpAccessTokenVersion(userId, appId);
    return revoked;
  }

  private buildAccessTokenVersionKey(appId: string, userId: string): string {
    return `${appId}:${userId}`;
  }
}
