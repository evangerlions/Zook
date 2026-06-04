import { ApplicationDatabase } from "../../infrastructure/database/application-database.ts";
import { KVManager } from "../../infrastructure/kv/kv-manager.ts";
import {
  badRequest,
  conflict,
  forbidden,
  unauthorized,
} from "../../shared/errors.ts";
import type {
  AccountDeletionResult,
  AppRecord,
  AuthContext,
  AuthSession,
  ChangePasswordCommand,
  ClientType,
  EmailLoginCodeCommand,
  EmailLoginCommand,
  LoginCommand,
  LogoutCommand,
  OneClickLoginCommand,
  PasswordSmsCodeCommand,
  PasswordEmailCodeCommand,
  RefreshCommand,
  RegisterBySmsCommand,
  RegisterCommand,
  RegisterEmailCodeCommand,
  RegisterEmailCodeResult,
  RegisterSmsCodeCommand,
  ResetPasswordCommand,
  ResetPasswordBySmsCommand,
  SetPasswordCommand,
  SmsLoginCodeCommand,
  SmsLoginCommand,
  UserRecord,
} from "../../shared/types.ts";
import { randomNumericCode, sha256 } from "../../shared/utils.ts";
import { CommonAuthRateLimitConfigService } from "../../services/common-auth-rate-limit-config.service.ts";
import { RefreshTokenStore } from "../../services/refresh-token-store.ts";
import type { RegistrationEmailSender } from "../../services/tencent-ses-registration-email.service.ts";
import type { SmsVerificationSender } from "../../services/tencent-sms-verification.service.ts";
import { SmsVerificationRecordService } from "../../services/sms-verification-record.service.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { UserService } from "../user/user.service.ts";
import { DevelopmentPasswordHasher } from "./password-hasher.ts";
import { TokenService } from "./token.service.ts";
import { AuthEmailFlow } from "./auth-email-flow.ts";
import { AuthSmsFlow } from "./auth-sms-flow.ts";
import { AuthSessionManager } from "./auth-session-manager.ts";
import { AuthVerificationLimiter } from "./auth-verification-limiter.ts";

interface LoginFailureState {
  count: number;
  windowStartedAt: number;
  lockedUntil?: number;
}

/**
 * AuthService implements the document's shared-account, password-only, bearer-only auth workflow.
 */
export class AuthService {
  private readonly loginFailureScope = "auth.login-failures";
  private readonly verificationLimiter: AuthVerificationLimiter;
  private readonly sessionManager: AuthSessionManager;
  private readonly emailFlow: AuthEmailFlow;
  private readonly smsFlow: AuthSmsFlow;
  private readonly failureWindowMs = 15 * 60 * 1000;
  private readonly maxFailedAttempts = 10;
  private readonly lockDurationMs = 15 * 60 * 1000;

  constructor(
    private readonly database: ApplicationDatabase,
    private readonly kvManager: KVManager,
    private readonly userService: UserService,
    private readonly appRegistryService: AppRegistryService,
    private readonly passwordHasher: DevelopmentPasswordHasher,
    private readonly tokenService: TokenService,
    private readonly refreshTokenStore: RefreshTokenStore,
    private readonly commonAuthRateLimitConfigService: CommonAuthRateLimitConfigService,
    private readonly registrationEmailSender: RegistrationEmailSender,
    private readonly smsVerificationSender: SmsVerificationSender,
    private readonly smsVerificationRecordService: SmsVerificationRecordService,
    private readonly registrationCodeGenerator: () => string = () =>
      randomNumericCode(6),
    private readonly secureRefreshCookie = false,
    private readonly refreshCookieSameSite: "Lax" | "None" | "Strict" = "Lax",
  ) {
    this.verificationLimiter = new AuthVerificationLimiter(
      kvManager,
      commonAuthRateLimitConfigService,
    );
    this.sessionManager = new AuthSessionManager(
      database,
      kvManager,
      userService,
      appRegistryService,
      tokenService,
      refreshTokenStore,
      secureRefreshCookie,
      refreshCookieSameSite,
    );
    this.emailFlow = new AuthEmailFlow(
      database,
      appRegistryService,
      passwordHasher,
      registrationEmailSender,
      this.verificationLimiter,
      this.sessionManager,
      registrationCodeGenerator,
    );
    this.smsFlow = new AuthSmsFlow(
      database,
      appRegistryService,
      passwordHasher,
      smsVerificationSender,
      smsVerificationRecordService,
      this.verificationLimiter,
      async (userId, appId, now) =>
        await this.sessionManager.issueSession(userId, appId, now),
      async (appId, userId, now) =>
        await this.sessionManager.revokeAllSessions(appId, userId, now),
      registrationCodeGenerator,
    );
  }

  async login(command: LoginCommand, now = new Date()): Promise<AuthSession> {
    const normalizedAccount = command.account.trim().toLowerCase();
    await this.assertNotLocked(normalizedAccount, now);

    const user = await this.database.findUserByAccount(normalizedAccount);
    if (!user || !this.verifyPassword(user, command.password)) {
      await this.registerFailure(normalizedAccount, now);
      unauthorized(
        "AUTH_INVALID_CREDENTIAL",
        "Account or password is invalid.",
      );
    }

    if (user.status === "BLOCKED") {
      forbidden("AUTH_USER_BLOCKED", "The user is blocked across all apps.");
    }

    await this.clearFailureState(normalizedAccount);
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    await this.appRegistryService.ensureMembership(app.id, user.id, now);

    return this.sessionManager.issueSession(user.id, app.id, now);
  }

  async registerEmailCode(
    command: RegisterEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.emailFlow.registerEmailCode(command, now);
  }

  async loginEmailCode(
    command: EmailLoginCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.emailFlow.loginEmailCode(command, now);
  }

  async register(
    command: RegisterCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    return await this.emailFlow.register(command, now);
  }

  async loginWithEmailCode(
    command: EmailLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    return await this.emailFlow.loginWithEmailCode(command, now);
  }

  async registerSmsCode(
    command: RegisterSmsCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.smsFlow.registerSmsCode(command, now);
  }

  async registerWithSms(
    command: RegisterBySmsCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    return await this.smsFlow.registerWithSms(command, now);
  }

  async loginSmsCode(
    command: SmsLoginCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.smsFlow.loginSmsCode(command, now);
  }

  async loginWithSmsCode(
    command: SmsLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    return await this.smsFlow.loginWithSmsCode(command, now);
  }

  async loginWithOneClickPhone(
    command: OneClickLoginCommand,
    now = new Date(),
  ): Promise<{ session: AuthSession; autoCreatedUser: boolean }> {
    return await this.smsFlow.loginWithOneClickPhone(command, now);
  }

  async refresh(
    command: RefreshCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    return await this.sessionManager.refresh(command, now);
  }

  async logout(
    command: LogoutCommand,
    auth: AuthContext,
    now = new Date(),
  ): Promise<number> {
    return await this.sessionManager.logout(command, auth, now);
  }

  async deleteCurrentAppAccount(
    command: {
      appId: string;
      userId: string;
      confirmation: string;
    },
    now = new Date(),
  ): Promise<AccountDeletionResult> {
    return await this.sessionManager.deleteCurrentAppAccount(command, now);
  }

  buildRefreshCookie(
    refreshToken: string,
    clientType: ClientType,
  ): string | undefined {
    return this.sessionManager.buildRefreshCookie(refreshToken, clientType);
  }

  buildClearRefreshCookie(): string {
    return this.sessionManager.buildClearRefreshCookie();
  }

  async issueSession(
    userId: string,
    appId: string,
    now = new Date(),
  ): Promise<AuthSession> {
    return this.sessionManager.issueSession(userId, appId, now);
  }

  async sendPasswordCode(
    command: PasswordEmailCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.emailFlow.sendPasswordCode(command, now);
  }

  async sendPasswordSmsCode(
    command: PasswordSmsCodeCommand,
    now = new Date(),
  ): Promise<RegisterEmailCodeResult> {
    return await this.smsFlow.sendPasswordSmsCode(command, now);
  }

  async resetPassword(
    command: ResetPasswordCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    return await this.emailFlow.resetPassword(command, now);
  }

  async resetPasswordBySms(
    command: ResetPasswordBySmsCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    return await this.smsFlow.resetPasswordBySms(command, now);
  }

  async changePassword(
    command: ChangePasswordCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const user = await this.userService.getById(command.userId);
    await this.appRegistryService.ensureExistingMembership(app.id, user.id);

    if (!this.passwordHasher.validateStrength(command.newPassword)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be 8-64 characters and include both letters and numbers.",
      );
    }

    if (!this.canVerifyPassword(user)) {
      badRequest(
        "REQ_INVALID_BODY",
        "This account does not have a password yet. Use the password reset flow instead.",
      );
    }

    if (!this.verifyPassword(user, command.currentPassword)) {
      unauthorized(
        "AUTH_INVALID_CREDENTIAL",
        "Account or password is invalid.",
      );
    }

    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.newPassword),
      this.passwordHasher.algorithm,
    );
    await this.sessionManager.revokeAllSessions(app.id, user.id, now);

    return this.sessionManager.issueSession(user.id, app.id, now);
  }

  async setPassword(
    command: SetPasswordCommand,
    now = new Date(),
  ): Promise<AuthSession> {
    const app = await this.appRegistryService.getAppOrThrow(command.appId);
    const user = await this.userService.getById(command.userId);
    await this.appRegistryService.ensureExistingMembership(app.id, user.id);

    if (!this.passwordHasher.validateStrength(command.password)) {
      badRequest(
        "REQ_INVALID_BODY",
        "Password must be 8-64 characters and include both letters and numbers.",
      );
    }

    if (
      user.passwordAlgo !== "email-code-only" &&
      user.passwordAlgo !== "sms-code-only"
    ) {
      conflict(
        "AUTH_PASSWORD_ALREADY_SET",
        "This account already has a password. Use the change password flow.",
      );
    }

    await this.database.updateUserPassword(
      user.id,
      this.passwordHasher.hash(command.password),
      this.passwordHasher.algorithm,
    );
    await this.sessionManager.revokeAllSessions(app.id, user.id, now);

    return this.sessionManager.issueSession(user.id, app.id, now);
  }

  async assertAccessTokenActive(auth: AuthContext): Promise<void> {
    await this.sessionManager.assertAccessTokenActive(auth);
  }

  private async assertNotLocked(
    account: string,
    now = new Date(),
  ): Promise<void> {
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

  private async registerFailure(
    account: string,
    now = new Date(),
  ): Promise<void> {
    const previous = await this.getFailureState(account);
    const currentTime = now.getTime();

    if (
      !previous ||
      currentTime - previous.windowStartedAt > this.failureWindowMs
    ) {
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

  private async getFailureState(
    account: string,
  ): Promise<LoginFailureState | undefined> {
    return this.kvManager.getJson<LoginFailureState>(
      this.loginFailureScope,
      this.buildFailureKey(account),
    );
  }

  private async setFailureState(
    account: string,
    state: LoginFailureState,
  ): Promise<void> {
    await this.kvManager.setJson(
      this.loginFailureScope,
      this.buildFailureKey(account),
      state,
    );
  }

  private async clearFailureState(account: string): Promise<void> {
    await this.kvManager.delete(
      this.loginFailureScope,
      this.buildFailureKey(account),
    );
  }

  private buildFailureKey(account: string): string {
    return sha256(account.trim().toLowerCase());
  }

  private canVerifyPassword(user: UserRecord): boolean {
    return (
      user.passwordAlgo === this.passwordHasher.algorithm ||
      user.passwordAlgo === "argon2id-adapter"
    );
  }

  private verifyPassword(user: UserRecord, password: string): boolean {
    return (
      this.canVerifyPassword(user) &&
      this.passwordHasher.verify(password, user.passwordHash)
    );
  }

}
