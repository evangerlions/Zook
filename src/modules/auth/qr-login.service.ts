import { InMemoryCache } from "../../infrastructure/cache/redis/in-memory-cache.ts";
import { conflict, forbidden, unauthorized } from "../../shared/errors.ts";
import type {
  AuthSession,
  ConfirmQrLoginCommand,
  CreateQrLoginCommand,
  PollQrLoginCommand,
  QrLoginConfirmResult,
  QrLoginCreateResult,
  QrLoginPollResult,
} from "../../shared/types.ts";
import { createOpaqueToken, randomId, sha256 } from "../../shared/utils.ts";
import { AppRegistryService } from "../app-registry/app-registry.service.ts";
import { UserService } from "../user/user.service.ts";
import { AuthService } from "./auth.service.ts";

interface StoredQrLoginSession {
  loginId: string;
  appId: string;
  status: "PENDING" | "CONFIRMED" | "COMPLETED";
  scanTokenHash: string;
  pollTokenHash: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt?: string;
  confirmedByUserId?: string;
  authSession?: AuthSession;
}

/**
 * QrLoginService manages short-lived QR login sessions for PC login confirmation by a mobile user.
 */
export class QrLoginService {
  private readonly sessionTtlMs = 2 * 60 * 1000;
  private readonly expiredSessionRetentionMs = 60 * 1000;
  private readonly pollIntervalMs = 2000;

  constructor(
    private readonly cache: InMemoryCache,
    private readonly appRegistryService: AppRegistryService,
    private readonly userService: UserService,
    private readonly authService: AuthService,
  ) {}

  createSession(command: CreateQrLoginCommand, now = new Date()): QrLoginCreateResult {
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    const loginId = randomId("qr_login");
    const scanToken = createOpaqueToken("qrs");
    const pollToken = createOpaqueToken("qrp");

    this.cache.set(
      this.buildSessionKey(loginId),
      {
        loginId,
        appId: app.id,
        status: "PENDING",
        scanTokenHash: sha256(scanToken),
        pollTokenHash: sha256(pollToken),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + this.sessionTtlMs).toISOString(),
      } satisfies StoredQrLoginSession,
      Math.ceil((this.sessionTtlMs + this.expiredSessionRetentionMs) / 1000),
      now,
    );

    return {
      loginId,
      qrContent: this.buildQrContent(app.id, loginId, scanToken),
      pollToken,
      expiresInSeconds: Math.floor(this.sessionTtlMs / 1000),
      pollIntervalMs: this.pollIntervalMs,
    };
  }

  confirm(command: ConfirmQrLoginCommand, now = new Date()): QrLoginConfirmResult {
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    const user = this.userService.getById(command.userId);
    this.appRegistryService.ensureExistingMembership(app.id, user.id);

    const session = this.getSessionOrThrow(command.loginId, now);
    this.assertSessionScope(session, app.id);
    this.assertScanToken(session, command.scanToken);

    if (session.status !== "PENDING") {
      conflict("AUTH_QR_LOGIN_ALREADY_USED", "QR login session is already confirmed or completed.");
    }

    session.status = "CONFIRMED";
    session.confirmedAt = now.toISOString();
    session.confirmedByUserId = user.id;
    session.authSession = this.authService.issueSession(user.id, app.id, now);

    this.saveSession(session, now);

    return {
      confirmed: true,
    };
  }

  poll(command: PollQrLoginCommand, now = new Date()): QrLoginPollResult {
    const app = this.appRegistryService.getAppOrThrow(command.appId);
    const session = this.getSessionOrThrow(command.loginId, now);
    this.assertSessionScope(session, app.id);
    this.assertPollToken(session, command.pollToken);

    if (session.status === "PENDING") {
      return {
        status: "PENDING",
        expiresInSeconds: this.getRemainingSeconds(session, now),
        pollIntervalMs: this.pollIntervalMs,
      };
    }

    if (session.status !== "CONFIRMED" || !session.authSession) {
      conflict("AUTH_QR_LOGIN_ALREADY_USED", "QR login session is already completed.");
    }

    const authSession = session.authSession;
    session.status = "COMPLETED";
    session.authSession = undefined;
    this.saveSession(session, now);

    return {
      status: "CONFIRMED",
      accessToken: authSession.accessToken,
      refreshToken: authSession.refreshToken,
      expiresIn: authSession.expiresIn,
    };
  }

  private getSessionOrThrow(loginId: string, now = new Date()): StoredQrLoginSession {
    const session = this.cache.get<StoredQrLoginSession>(this.buildSessionKey(loginId), now);
    if (!session) {
      unauthorized("AUTH_QR_LOGIN_INVALID", "QR login session is invalid.");
    }

    if (new Date(session.expiresAt) <= now) {
      this.cache.delete(this.buildSessionKey(loginId));
      unauthorized("AUTH_QR_LOGIN_EXPIRED", "QR login session is expired.");
    }

    return session;
  }

  private assertSessionScope(session: StoredQrLoginSession, appId: string): void {
    if (session.appId !== appId) {
      forbidden("AUTH_APP_SCOPE_MISMATCH", "QR login app scope does not match the request.");
    }
  }

  private assertScanToken(session: StoredQrLoginSession, scanToken: string): void {
    if (!scanToken.trim()) {
      unauthorized("AUTH_QR_LOGIN_TOKEN_REQUIRED", "QR login scan token is required.");
    }

    if (sha256(scanToken.trim()) !== session.scanTokenHash) {
      unauthorized("AUTH_QR_LOGIN_INVALID", "QR login session is invalid.");
    }
  }

  private assertPollToken(session: StoredQrLoginSession, pollToken: string): void {
    if (!pollToken.trim()) {
      unauthorized("AUTH_QR_LOGIN_TOKEN_REQUIRED", "QR login poll token is required.");
    }

    if (sha256(pollToken.trim()) !== session.pollTokenHash) {
      unauthorized("AUTH_QR_LOGIN_INVALID", "QR login session is invalid.");
    }
  }

  private saveSession(session: StoredQrLoginSession, now = new Date()): void {
    this.cache.set(
      this.buildSessionKey(session.loginId),
      session,
      Math.max(
        this.getRemainingSeconds(session, now) +
          Math.ceil(this.expiredSessionRetentionMs / 1000),
        1,
      ),
      now,
    );
  }

  private getRemainingSeconds(session: StoredQrLoginSession, now = new Date()): number {
    return Math.max(
      Math.ceil((new Date(session.expiresAt).getTime() - now.getTime()) / 1000),
      0,
    );
  }

  private buildSessionKey(loginId: string): string {
    return `auth:qr-login:${loginId}`;
  }

  private buildQrContent(appId: string, loginId: string, scanToken: string): string {
    return `zook://auth/qr-login?appId=${encodeURIComponent(appId)}&loginId=${encodeURIComponent(
      loginId,
    )}&scanToken=${encodeURIComponent(scanToken)}`;
  }
}
