import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import {
  badRequest,
  conflict,
  forbidden,
  tooManyRequests,
  unauthorized,
} from "../../shared/errors.ts";
import type {
  AuthSession,
  EmailLoginCodeCommand,
  EmailLoginCommand,
  PasswordEmailCodeCommand,
  RegisterCommand,
  RegisterEmailCodeCommand,
  RegisterEmailCodeResult,
  ResetPasswordCommand,
} from "../../shared/types.ts";
import {
  createOpaqueToken,
  randomId,
  sha256,
  timingSafeHexCompare,
} from "../../shared/utils.ts";
import { VERIFICATION_EMAIL_TEMPLATE_NAME } from "../../services/common-email-config.service.ts";
import type { RegistrationEmailSender } from "../../services/tencent-ses-registration-email.service.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { DevelopmentPasswordHasher } from "./password-hasher.ts";
import { AuthSessionManager } from "./auth-session-manager.ts";
import {
  AuthVerificationLimiter,
  type AuthRateLimitRuntimeConfig,
  type EmailVerificationCacheEntry,
} from "./auth-verification-limiter.ts";

export class AuthEmailFlow {
  private readonly localEmailLoginBypassEmail = "evangerlions@gmail.com";
  private readonly localEmailLoginBypassCode = "852133";

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly registrationEmailSender: RegistrationEmailSender,
    private readonly verificationLimiter: AuthVerificationLimiter,
    private readonly sessionManager: AuthSessionManager,
    private readonly registrationCodeGenerator: () => string,
  ) {}

  async registerEmailCode(
    command: RegisterEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeRegistrationCodeLimits(
      app.id,
      email,
      ipAddress,
      rateLimit,
      now,
    );
    return await this.issueEmailCode({
      app,
      email,
      cacheKey: this.verificationLimiter.buildRegistrationCodeKey(app.id, email),
      command,
      rateLimit,
      now,
    });
  }

  async loginEmailCode(
    command: EmailLoginCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeEmailLoginCodeLimits(
      app.id,
      email,
      ipAddress,
      rateLimit,
      now,
    );
    if (this.isLocalEmailLoginBypassAccount(email, ipAddress)) {
      return this.buildAcceptedResult(rateLimit);
    }
    return await this.issueEmailCode({
      app,
      email,
      cacheKey: this.verificationLimiter.buildEmailLoginCodeKey(app.id, email),
      command,
      rateLimit,
      now,
    });
  }

  async register(command: RegisterCommand, now = new Date()): Promise<AuthSession> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeRegistrationLimits(
      app.id,
      email,
      ipAddress,
      rateLimit,
      now,
    );
    this.assertPasswordStrength(command.password);
    const cacheKey = this.verificationLimiter.buildRegistrationCodeKey(app.id, email);
    await this.assertEmailCodeValid({
      cacheKey,
      code: command.emailCode,
      maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
      now,
      label: "Email",
      consume: false,
    });
    if (await this.database.findUserByAccount(email)) {
      conflict(
        "AUTH_ACCOUNT_ALREADY_EXISTS",
        "Registration is not available for the provided email.",
      );
    }
    await this.verificationLimiter.deleteVerificationCodeEntry(cacheKey);
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
    return await this.sessionManager.issueSession(userId, app.id, now);
  }

  async loginWithEmailCode(
    command: EmailLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    const emailCode = command.emailCode.trim();
    if (!emailCode) {
      unauthorized(
        "AUTH_VERIFICATION_CODE_REQUIRED",
        "Email verification code is required.",
      );
    }
    const bypassMatched = this.matchesLocalEmailLoginBypass(email, emailCode, ipAddress);
    if (!bypassMatched) {
      await this.verificationLimiter.consumeEmailLoginLimits(
        app.id,
        email,
        ipAddress,
        rateLimit,
        now,
      );
      await this.assertEmailCodeValid({
        cacheKey: this.verificationLimiter.buildEmailLoginCodeKey(app.id, email),
        code: emailCode,
        maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
        now,
        label: "Email",
      });
    }
    let user = await this.database.findUserByAccount(email);
    let autoCreatedUser = false;
    if (!user) {
      if (app.joinMode !== "AUTO") {
        forbidden(
          "APP_JOIN_INVITE_REQUIRED",
          "This app requires an invite to join.",
        );
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
      session: await this.sessionManager.issueSession(user.id, app.id, now),
      autoCreatedUser,
    };
  }

  async sendPasswordCode(
    command: PasswordEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumePasswordCodeLimits(
      app.id,
      email,
      ipAddress,
      rateLimit,
      now,
    );
    const cacheKey = this.verificationLimiter.buildPasswordResetCodeKey(app.id, email);
    await this.assertResendCooldown(cacheKey, rateLimit, now);
    const user = await this.database.findUserByAccount(email);
    if (
      !user ||
      user.status === "BLOCKED" ||
      !(await this.canUsePasswordFlow(app.id, user.id))
    ) {
      return this.buildAcceptedResult(rateLimit);
    }
    return await this.issueEmailCode({
      app,
      email,
      cacheKey,
      command,
      rateLimit,
      now,
    });
  }

  async resetPassword(
    command: ResetPasswordCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const email = this.normalizeEmail(command.email);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumePasswordResetLimits(
      app.id,
      email,
      ipAddress,
      rateLimit,
      now,
    );
    this.assertPasswordStrength(command.password);
    await this.assertEmailCodeValid({
      cacheKey: this.verificationLimiter.buildPasswordResetCodeKey(app.id, email),
      code: command.emailCode,
      maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
      now,
      label: "Email",
    });
    const user = await this.database.findUserByAccount(email);
    if (
      !user ||
      user.status === "BLOCKED" ||
      !(await this.canUsePasswordFlow(app.id, user.id))
    ) {
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        "Email verification code is invalid or expired.",
      );
    }
    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.password),
      this.passwordHasher.algorithm,
    );
    await this.sessionManager.revokeAllSessions(app.id, user.id, now);
    await this.appRegistryService.ensureMembership(app.id, user.id, now);
    return await this.sessionManager.issueSession(user.id, app.id, now);
  }

  private async issueEmailCode(input: {
    app: { id: string };
    email: string;
    cacheKey: string;
    command: RegisterEmailCodeCommand | EmailLoginCodeCommand | PasswordEmailCodeCommand;
    rateLimit: AuthRateLimitRuntimeConfig;
    now: Date;
  }): Promise<RegisterEmailCodeResult> {
    const existingCode = await this.verificationLimiter.getVerificationCodeEntry(input.cacheKey, input.now);
    if (
      existingCode &&
      input.now.getTime() - new Date(existingCode.sentAt).getTime() <
        input.rateLimit.resendCooldownMs
    ) {
      tooManyRequests(
        "AUTH_RATE_LIMITED",
        "Request rate is too high. Please retry later.",
      );
    }
    const rawCode = this.createVerificationCode();
    const entry = this.createVerificationCodeEntry(
      rawCode,
      input.now,
      input.rateLimit.verificationCodeTtlMs,
    );
    await this.verificationLimiter.setVerificationCodeEntry(
      input.cacheKey,
      entry,
      input.rateLimit.verificationCodeTtlMs,
      input.now,
    );
    try {
      await this.registrationEmailSender.sendVerificationCode({
        appName: this.appRegistryService.resolveLocalizedAppName(input.app, {
          locale: input.command.locale,
          region: input.command.region,
        }),
        email: input.email,
        code: rawCode,
        locale: input.command.locale.trim() || "zh-CN",
        region: input.command.region,
        expireMinutes: Math.floor(input.rateLimit.verificationCodeTtlMs / (60 * 1000)),
        templateName: VERIFICATION_EMAIL_TEMPLATE_NAME,
      });
    } catch (error) {
      await this.verificationLimiter.deleteVerificationCodeEntry(input.cacheKey);
      throw error;
    }
    return this.buildAcceptedResult(input.rateLimit);
  }

  private async assertEmailCodeValid(input: {
    cacheKey: string;
    code: string;
    maxFailedCodeAttempts: number;
    now: Date;
    label: "Email";
    consume?: boolean;
  }): Promise<void> {
    const emailCode = input.code.trim();
    if (!emailCode) {
      unauthorized(
        "AUTH_VERIFICATION_CODE_REQUIRED",
        `${input.label} verification code is required.`,
      );
    }
    const cachedCode = await this.verificationLimiter.getVerificationCodeEntry(input.cacheKey, input.now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= input.now) {
      await this.verificationLimiter.deleteVerificationCodeEntry(input.cacheKey);
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        `${input.label} verification code is invalid or expired.`,
      );
    }
    if (cachedCode.failedAttempts >= input.maxFailedCodeAttempts) {
      await this.verificationLimiter.deleteVerificationCodeEntry(input.cacheKey);
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        `${input.label} verification code is invalid or expired.`,
      );
    }
    if (!timingSafeHexCompare(sha256(emailCode), cachedCode.codeHash)) {
      await this.verificationLimiter.recordFailedCodeAttempt(
        input.cacheKey,
        cachedCode,
        input.maxFailedCodeAttempts,
        input.now,
      );
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        `${input.label} verification code is invalid or expired.`,
      );
    }
    if (input.consume !== false) {
      await this.verificationLimiter.deleteVerificationCodeEntry(input.cacheKey);
    }
  }

  private async assertResendCooldown(
    cacheKey: string,
    rateLimit: AuthRateLimitRuntimeConfig,
    now: Date,
  ): Promise<void> {
    const existingCode = await this.verificationLimiter.getVerificationCodeEntry(cacheKey, now);
    if (
      existingCode &&
      now.getTime() - new Date(existingCode.sentAt).getTime() <
        rateLimit.resendCooldownMs
    ) {
      tooManyRequests(
        "AUTH_RATE_LIMITED",
        "Request rate is too high. Please retry later.",
      );
    }
  }

  private async canUsePasswordFlow(appId: string, userId: string): Promise<boolean> {
    const membership = await this.database.findAppUser(appId, userId);
    if (membership) {
      return membership.status === "ACTIVE";
    }
    return (
      (await this.appRegistryService.getAppOrThrow(appId)).joinMode === "AUTO"
    );
  }

  private async assertSelfRegistrationAllowed(appId: string) {
    const app = await this.appRegistryService.getAppOrThrow(appId);
    if (app.joinMode !== "AUTO") {
      forbidden(
        "APP_JOIN_INVITE_REQUIRED",
        "This app requires an invite to join.",
      );
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

  private createVerificationCode(): string {
    const rawCode = this.registrationCodeGenerator();
    if (!/^\d{6}$/.test(rawCode)) {
      throw new Error(
        "Registration code generator must return a 6-digit numeric string.",
      );
    }
    return rawCode;
  }

  private createVerificationCodeEntry(
    code: string,
    now = new Date(),
    verificationCodeTtlMs: number,
  ): EmailVerificationCacheEntry {
    return {
      codeHash: sha256(code),
      expiresAt: new Date(now.getTime() + verificationCodeTtlMs).toISOString(),
      sentAt: now.toISOString(),
      failedAttempts: 0,
    };
  }

  private buildAcceptedResult(
    rateLimit: AuthRateLimitRuntimeConfig,
  ): RegisterEmailCodeResult {
    return {
      accepted: true,
      cooldownSeconds: Math.floor(rateLimit.resendCooldownMs / 1000),
      expiresInSeconds: Math.floor(rateLimit.verificationCodeTtlMs / 1000),
    };
  }

  private isLocalEmailLoginBypassAccount(
    email: string,
    ipAddress: string,
  ): boolean {
    return (
      this.isLocalEmailLoginBypassEnabled(ipAddress) &&
      email === this.localEmailLoginBypassEmail
    );
  }

  private matchesLocalEmailLoginBypass(
    email: string,
    emailCode: string,
    ipAddress: string,
  ): boolean {
    return (
      this.isLocalEmailLoginBypassAccount(email, ipAddress) &&
      emailCode === this.localEmailLoginBypassCode
    );
  }

  private isLocalEmailLoginBypassEnabled(ipAddress: string): boolean {
    const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
    const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
    const normalizedIp = ipAddress.trim();
    return (
      appEnv === "local" ||
      nodeEnv === "development" ||
      normalizedIp === "127.0.0.1" ||
      normalizedIp === "::1" ||
      normalizedIp === "unknown"
    );
  }

  private assertPasswordStrength(password: string): void {
    if (!this.passwordHasher.validateStrength(password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be 8-64 characters and include both letters and numbers.",
      );
    }
  }
}
