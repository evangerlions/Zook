import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import {
  badRequest,
  conflict,
  forbidden,
  tooManyRequests,
  unauthorized,
} from "../../shared/errors.ts";
import type {
  AppRecord,
  AuthSession,
  OneClickLoginCommand,
  PasswordSmsCodeCommand,
  RegisterBySmsCommand,
  RegisterEmailCodeResult,
  RegisterSmsCodeCommand,
  ResetPasswordBySmsCommand,
  SmsLoginCodeCommand,
  SmsLoginCommand,
} from "../../shared/types.ts";
import {
  createOpaqueToken,
  randomId,
  sha256,
  timingSafeHexCompare,
} from "../../shared/utils.ts";
import type { SmsVerificationSender } from "../../services/tencent-sms-verification.service.ts";
import { SmsVerificationRecordService } from "../../services/sms-verification-record.service.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { DevelopmentPasswordHasher } from "./password-hasher.ts";
import {
  AuthVerificationLimiter,
  type AuthRateLimitRuntimeConfig,
} from "./auth-verification-limiter.ts";
import { buildSmsProviderFailure } from "./auth-sms-provider-failure.ts";

export class AuthSmsFlow {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly smsVerificationSender: SmsVerificationSender,
    private readonly smsVerificationRecordService: SmsVerificationRecordService,
    private readonly verificationLimiter: AuthVerificationLimiter,
    private readonly issueSession: (
      userId: string,
      appId: string,
      now: Date,
    ) => Promise<AuthSession>,
    private readonly revokeAllSessions: (
      appId: string,
      userId: string,
      now: Date,
    ) => Promise<number>,
    private readonly registrationCodeGenerator: () => string,
  ) {}

  async registerSmsCode(
    command: RegisterSmsCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeRegistrationCodeLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    return await this.issueSmsCode({
      app,
      phone,
      phoneNa: command.phoneNa,
      ipAddress,
      cacheKey: this.verificationLimiter.buildRegistrationCodeKey(app.id, phone, "sms"),
      scene: "register",
      rateLimit,
      now,
      test: command.test === true,
    });
  }

  async registerWithSms(
    command: RegisterBySmsCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.assertSelfRegistrationAllowed(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeRegistrationLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    await this.assertSmsCodeValid({
      appId: app.id,
      subject: phone,
      code: command.smsCode,
      kind: "register",
      maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
      now,
    });
    if (await this.database.findUserByPhone(phone)) {
      conflict(
        "AUTH_ACCOUNT_ALREADY_EXISTS",
        "Registration is not available for the provided phone.",
      );
    }
    const userId = randomId("user");
    await this.database.insertUser({
      id: userId,
      phone,
      passwordHash: this.passwordHasher.hash(createOpaqueToken("pwd")),
      passwordAlgo: "sms-code-only",
      status: "ACTIVE",
      createdAt: now.toISOString(),
    });
    await this.appRegistryService.ensureMembership(app.id, userId, now);
    return await this.issueSession(userId, app.id, now);
  }

  async loginSmsCode(
    command: SmsLoginCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeEmailLoginCodeLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    return await this.issueSmsCode({
      app,
      phone,
      phoneNa: command.phoneNa,
      ipAddress,
      cacheKey: this.verificationLimiter.buildEmailLoginCodeKey(app.id, phone, "sms"),
      scene: "login",
      rateLimit,
      now,
      test: command.test === true,
    });
  }

  async loginWithSmsCode(
    command: SmsLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeEmailLoginLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    await this.assertSmsCodeValid({
      appId: app.id,
      subject: phone,
      code: command.smsCode,
      kind: "login",
      maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
      now,
    });
    return await this.loginWithVerifiedPhone({ app, phone, now });
  }

  async loginWithOneClickPhone(
    command: OneClickLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumeEmailLoginLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    return await this.loginWithVerifiedPhone({ app, phone, now });
  }

  async sendPasswordSmsCode(
    command: PasswordSmsCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumePasswordCodeLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    const cacheKey = this.verificationLimiter.buildPasswordResetCodeKey(app.id, phone, "sms");
    await this.assertResendCooldown(cacheKey, rateLimit, now);
    const user = await this.database.findUserByPhone(phone);
    if (
      !user ||
      user.status === "BLOCKED" ||
      !(await this.canUsePasswordFlow(app.id, user.id))
    ) {
      return this.buildAcceptedResult(rateLimit);
    }
    return await this.issueSmsCode({
      app,
      phone,
      phoneNa: command.phoneNa,
      ipAddress,
      cacheKey,
      scene: "password-reset",
      rateLimit,
      now,
      test: command.test === true,
    });
  }

  async resetPasswordBySms(
    command: ResetPasswordBySmsCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const rateLimit = await this.verificationLimiter.getRuntimeConfig();
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const phone = this.normalizePhone(command.phone, command.phoneNa);
    const ipAddress = this.normalizeIpAddress(command.ipAddress);
    await this.verificationLimiter.consumePasswordResetLimits(
      app.id,
      phone,
      ipAddress,
      rateLimit,
      now,
      "sms",
    );
    if (!this.passwordHasher.validateStrength(command.password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be 8-64 characters and include both letters and numbers.",
      );
    }
    await this.assertSmsCodeValid({
      appId: app.id,
      subject: phone,
      code: command.smsCode,
      kind: "password-reset",
      maxFailedCodeAttempts: rateLimit.maxFailedCodeAttempts,
      now,
    });
    const user = await this.database.findUserByPhone(phone);
    if (
      !user ||
      user.status === "BLOCKED" ||
      !(await this.canUsePasswordFlow(app.id, user.id))
    ) {
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        "SMS verification code is invalid or expired.",
      );
    }
    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.password),
      this.passwordHasher.algorithm,
    );
    await this.revokeAllSessions(app.id, user.id, now);
    await this.appRegistryService.ensureMembership(app.id, user.id, now);
    return await this.issueSession(user.id, app.id, now);
  }

  private async issueSmsCode(input: {
    app: AppRecord;
    phone: string;
    phoneNa?: string;
    ipAddress: string;
    cacheKey: string;
    scene: "register" | "login" | "password-reset";
    rateLimit: AuthRateLimitRuntimeConfig;
    now: Date;
    test: boolean;
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
    const verificationEntry = {
      codeHash: sha256(rawCode),
      expiresAt: new Date(input.now.getTime() + input.rateLimit.verificationCodeTtlMs).toISOString(),
      sentAt: input.now.toISOString(),
      failedAttempts: 0,
    };
    await this.verificationLimiter.setVerificationCodeEntry(
      input.cacheKey,
      verificationEntry,
      input.rateLimit.verificationCodeTtlMs,
      input.now,
    );
    const smsRecord = await this.smsVerificationRecordService.recordIssued({
      appId: input.app.id,
      scene: input.scene,
      phone: input.phone,
      phoneNa: input.phoneNa,
      code: rawCode,
      isTest: input.test,
      sentAt: verificationEntry.sentAt,
      expiresAt: verificationEntry.expiresAt,
    });
    if (!input.test) {
      try {
        const sendResult =
          await this.smsVerificationSender.sendVerificationCode({
            phoneNumber: input.phone,
            code: rawCode,
            expireMinutes: Math.floor(
              input.rateLimit.verificationCodeTtlMs / (60 * 1000),
            ),
          });
        await this.smsVerificationRecordService.markProviderAccepted(
          smsRecord.id,
          {
            providerRequestId: sendResult.requestId,
            providerSerialNo: sendResult.sendSerialNo,
          },
        );
      } catch (error) {
        await this.verificationLimiter.deleteVerificationCodeEntry(input.cacheKey);
        await this.smsVerificationRecordService.markProviderFailed(
          smsRecord.id,
          buildSmsProviderFailure(error),
        );
        throw error;
      }
    }
    return this.buildAcceptedResult(input.rateLimit);
  }

  private async loginWithVerifiedPhone(input: {
    app: AppRecord;
    phone: string;
    now: Date;
  }): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    let user = await this.database.findUserByPhone(input.phone);
    let autoCreatedUser = false;
    if (!user) {
      if (input.app.joinMode !== "AUTO") {
        forbidden(
          "APP_JOIN_INVITE_REQUIRED",
          "This app requires an invite to join.",
        );
      }
      autoCreatedUser = true;
      user = {
        id: randomId("user"),
        phone: input.phone,
        passwordHash: this.passwordHasher.hash(createOpaqueToken("pwd")),
        passwordAlgo: "sms-code-only",
        status: "ACTIVE",
        createdAt: input.now.toISOString(),
      };
      await this.database.insertUser(user);
    }
    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }
    await this.appRegistryService.ensureMembership(input.app.id, user.id, input.now);
    return {
      session: await this.issueSession(user.id, input.app.id, input.now),
      autoCreatedUser,
    };
  }

  private async assertSmsCodeValid(command: {
    appId: string;
    subject: string;
    code: string;
    kind: "login" | "register" | "password-reset";
    maxFailedCodeAttempts: number;
    now?: Date;
  }): Promise<void> {
    const now = command.now ?? new Date();
    const smsCode = command.code.trim();
    if (!smsCode) {
      unauthorized(
        "AUTH_VERIFICATION_CODE_REQUIRED",
        "SMS verification code is required.",
      );
    }
    const cacheKey = this.resolveSmsVerificationCacheKey(
      command.appId,
      command.subject,
      command.kind,
    );
    const cachedCode = await this.verificationLimiter.getVerificationCodeEntry(cacheKey, now);
    if (!cachedCode || new Date(cachedCode.expiresAt) <= now) {
      await this.verificationLimiter.deleteVerificationCodeEntry(cacheKey);
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        "SMS verification code is invalid or expired.",
      );
    }
    if (cachedCode.failedAttempts >= command.maxFailedCodeAttempts) {
      await this.verificationLimiter.deleteVerificationCodeEntry(cacheKey);
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        "SMS verification code is invalid or expired.",
      );
    }
    if (!timingSafeHexCompare(sha256(smsCode), cachedCode.codeHash)) {
      await this.verificationLimiter.recordFailedCodeAttempt(
        cacheKey,
        cachedCode,
        command.maxFailedCodeAttempts,
        now,
      );
      unauthorized(
        "AUTH_VERIFICATION_CODE_INVALID",
        "SMS verification code is invalid or expired.",
      );
    }
    await this.verificationLimiter.deleteVerificationCodeEntry(cacheKey);
    await this.smsVerificationRecordService.markConsumed({
      appId: command.appId,
      scene: command.kind,
      phone: command.subject,
      code: smsCode,
      now,
    });
  }

  private resolveSmsVerificationCacheKey(
    appId: string,
    phone: string,
    kind: "login" | "register" | "password-reset",
  ): string {
    if (kind === "register") {
      return this.verificationLimiter.buildRegistrationCodeKey(appId, phone, "sms");
    }
    if (kind === "password-reset") {
      return this.verificationLimiter.buildPasswordResetCodeKey(appId, phone, "sms");
    }
    return this.verificationLimiter.buildEmailLoginCodeKey(appId, phone, "sms");
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

  private normalizePhone(phone: string, phoneNa?: string): string {
    const rawPhone = phone.trim();
    const rawPhoneNa = phoneNa?.trim() || "+86";
    const normalizedPhoneNa = rawPhoneNa.startsWith("+") ? rawPhoneNa : `+${rawPhoneNa}`;
    const digitsOnly = rawPhone.replace(/[^\d]/g, "");
    if (!/^\+\d{1,4}$/.test(normalizedPhoneNa)) {
      badRequest("REQ_INVALID_BODY", "phoneNa must be a valid country calling code.");
    }
    if (!/^\d{4,20}$/.test(digitsOnly)) {
      badRequest("REQ_INVALID_BODY", "phone must be a valid phone number.");
    }
    if (normalizedPhoneNa === "+86" && !/^1\d{10}$/.test(digitsOnly)) {
      badRequest("REQ_INVALID_BODY", "phone must be a valid mainland China mobile number.");
    }
    return `${normalizedPhoneNa}${digitsOnly}`;
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

  private buildAcceptedResult(
    rateLimit: AuthRateLimitRuntimeConfig,
  ): RegisterEmailCodeResult {
    return {
      accepted: true,
      cooldownSeconds: Math.floor(rateLimit.resendCooldownMs / 1000),
      expiresInSeconds: Math.floor(rateLimit.verificationCodeTtlMs / 1000),
    };
  }

}
