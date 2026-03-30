import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import { badRequest, forbidden, tooManyRequests } from "../shared/errors.ts";
import type {
  AdminSensitiveOperationCodeRequestDocument,
  AdminSensitiveOperationGrantDocument,
  AdminSessionRecord,
  TencentSesRegion,
} from "../shared/types.ts";
import { randomNumericCode, sha256, timingSafeHexCompare } from "../shared/utils.ts";
import { VERIFICATION_EMAIL_TEMPLATE_NAME } from "./common-email-config.service.ts";
import type { RegistrationEmailSender } from "./tencent-ses-registration-email.service.ts";

interface SensitiveCodeRecord {
  operation: string;
  codeHash: string;
  sentAt: string;
  expiresAt: string;
  failedAttempts: number;
}

interface SensitiveGrantRecord {
  operation: string;
  grantedAt: string;
  expiresAt: string;
}

interface AdminSensitiveOperationServiceOptions {
  recipientEmail?: string;
  locale?: string;
  region?: TencentSesRegion;
  templateName?: string;
  appName?: string;
  codeTtlMs?: number;
  resendCooldownMs?: number;
  grantTtlMs?: number;
  maxFailedAttempts?: number;
  codeGenerator?: () => string;
}

const SENSITIVE_OPERATION_SCOPE = "admin.sensitive-operation";

export class AdminSensitiveOperationService {
  private readonly recipientEmail: string;
  private readonly locale: string;
  private readonly region: TencentSesRegion;
  private readonly templateName: string;
  private readonly appName: string;
  private readonly codeTtlMs: number;
  private readonly resendCooldownMs: number;
  private readonly grantTtlMs: number;
  private readonly maxFailedAttempts: number;
  private readonly codeGenerator: () => string;

  constructor(
    private readonly kvManager: KVManager,
    private readonly emailSender: RegistrationEmailSender,
    options: AdminSensitiveOperationServiceOptions = {},
  ) {
    this.recipientEmail = (options.recipientEmail ?? "evangerlions@gmail.com").trim().toLowerCase();
    this.locale = (options.locale ?? "zh-CN").trim() || "zh-CN";
    this.region = options.region ?? "ap-hongkong";
    this.templateName = (options.templateName ?? VERIFICATION_EMAIL_TEMPLATE_NAME).trim() || VERIFICATION_EMAIL_TEMPLATE_NAME;
    this.appName = (options.appName ?? "Zook 管理后台").trim() || "Zook 管理后台";
    this.codeTtlMs = options.codeTtlMs ?? 10 * 60 * 1000;
    this.resendCooldownMs = options.resendCooldownMs ?? 60 * 1000;
    this.grantTtlMs = options.grantTtlMs ?? 60 * 60 * 1000;
    this.maxFailedAttempts = options.maxFailedAttempts ?? 5;
    this.codeGenerator = options.codeGenerator ?? (() => randomNumericCode(6));
  }

  async requestCode(
    session: AdminSessionRecord,
    operation: string,
    now = new Date(),
  ): Promise<AdminSensitiveOperationCodeRequestDocument> {
    const normalizedOperation = this.normalizeOperation(operation);
    const existing = await this.kvManager.getJson<SensitiveCodeRecord>(
      SENSITIVE_OPERATION_SCOPE,
      this.codeKey(session.id, normalizedOperation),
    );

    if (
      existing
      && now.getTime() - new Date(existing.sentAt).getTime() < this.resendCooldownMs
      && new Date(existing.expiresAt).getTime() > now.getTime()
    ) {
      tooManyRequests(
        "ADMIN_SENSITIVE_RATE_LIMITED",
        "Sensitive verification code was requested too frequently.",
      );
    }

    const code = this.codeGenerator();
    if (!/^\d{6}$/.test(code)) {
      throw new Error("Sensitive operation code generator must return a 6-digit numeric string.");
    }

    const entry: SensitiveCodeRecord = {
      operation: normalizedOperation,
      codeHash: sha256(code),
      sentAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.codeTtlMs).toISOString(),
      failedAttempts: 0,
    };

    await this.kvManager.setJson(
      SENSITIVE_OPERATION_SCOPE,
      this.codeKey(session.id, normalizedOperation),
      entry,
    );

    try {
      await this.emailSender.sendVerificationCode({
        appName: this.appName,
        email: this.recipientEmail,
        code,
        locale: this.locale,
        region: this.region,
        expireMinutes: Math.floor(this.codeTtlMs / (60 * 1000)),
        templateName: this.templateName,
      });
    } catch (error) {
      await this.kvManager.delete(
        SENSITIVE_OPERATION_SCOPE,
        this.codeKey(session.id, normalizedOperation),
      );
      throw error;
    }

    return {
      operation: normalizedOperation,
      recipientEmailMasked: this.maskEmail(this.recipientEmail),
      cooldownSeconds: Math.floor(this.resendCooldownMs / 1000),
      expiresInSeconds: Math.floor(this.codeTtlMs / 1000),
    };
  }

  async verifyCode(
    session: AdminSessionRecord,
    operation: string,
    code: string,
    now = new Date(),
  ): Promise<AdminSensitiveOperationGrantDocument> {
    const normalizedOperation = this.normalizeOperation(operation);
    const normalizedCode = code.trim();
    if (!normalizedCode) {
      badRequest("ADMIN_SENSITIVE_CODE_REQUIRED", "Sensitive verification code is required.");
    }

    const cacheKey = this.codeKey(session.id, normalizedOperation);
    const existing = await this.kvManager.getJson<SensitiveCodeRecord>(SENSITIVE_OPERATION_SCOPE, cacheKey);
    if (!existing || new Date(existing.expiresAt).getTime() <= now.getTime()) {
      await this.kvManager.delete(SENSITIVE_OPERATION_SCOPE, cacheKey);
      badRequest("ADMIN_SENSITIVE_CODE_INVALID", "Sensitive verification code is invalid or expired.");
    }

    if (existing.failedAttempts >= this.maxFailedAttempts) {
      await this.kvManager.delete(SENSITIVE_OPERATION_SCOPE, cacheKey);
      badRequest("ADMIN_SENSITIVE_CODE_INVALID", "Sensitive verification code is invalid or expired.");
    }

    if (!timingSafeHexCompare(sha256(normalizedCode), existing.codeHash)) {
      const failedAttempts = existing.failedAttempts + 1;
      if (failedAttempts >= this.maxFailedAttempts) {
        await this.kvManager.delete(SENSITIVE_OPERATION_SCOPE, cacheKey);
      } else {
        await this.kvManager.setJson(SENSITIVE_OPERATION_SCOPE, cacheKey, {
          ...existing,
          failedAttempts,
        } satisfies SensitiveCodeRecord);
      }
      badRequest("ADMIN_SENSITIVE_CODE_INVALID", "Sensitive verification code is invalid or expired.");
    }

    await this.kvManager.delete(SENSITIVE_OPERATION_SCOPE, cacheKey);

    const grant: SensitiveGrantRecord = {
      operation: normalizedOperation,
      grantedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + this.grantTtlMs).toISOString(),
    };
    await this.kvManager.setJson(
      SENSITIVE_OPERATION_SCOPE,
      this.grantKey(session.id, normalizedOperation),
      grant,
    );

    return {
      operation: normalizedOperation,
      granted: true,
      expiresAt: grant.expiresAt,
    };
  }

  async assertGranted(session: AdminSessionRecord, operation: string, now = new Date()): Promise<void> {
    const normalizedOperation = this.normalizeOperation(operation);
    const grantKey = this.grantKey(session.id, normalizedOperation);
    const existing = await this.kvManager.getJson<SensitiveGrantRecord>(SENSITIVE_OPERATION_SCOPE, grantKey);
    if (!existing) {
      forbidden(
        "ADMIN_SENSITIVE_OPERATION_REQUIRED",
        "Sensitive operation verification is required.",
      );
    }

    if (new Date(existing.expiresAt).getTime() <= now.getTime()) {
      await this.kvManager.delete(SENSITIVE_OPERATION_SCOPE, grantKey);
      forbidden(
        "ADMIN_SENSITIVE_OPERATION_REQUIRED",
        "Sensitive operation verification is required.",
      );
    }
  }

  private normalizeOperation(operation: string): string {
    const normalized = operation.trim();
    if (!normalized) {
      badRequest("REQ_INVALID_BODY", "Sensitive operation is required.");
    }

    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized)) {
      badRequest("REQ_INVALID_BODY", "Sensitive operation is invalid.");
    }

    return normalized;
  }

  private codeKey(sessionId: string, operation: string): string {
    return `code:${sessionId}:${operation}`;
  }

  private grantKey(sessionId: string, operation: string): string {
    return `grant:${sessionId}:${operation}`;
  }

  private maskEmail(value: string): string {
    const [localPart, domain] = value.split("@");
    if (!localPart || !domain) {
      return value;
    }

    const visiblePrefix = localPart.slice(0, Math.min(2, localPart.length));
    return `${visiblePrefix}${"*".repeat(Math.max(2, localPart.length - visiblePrefix.length))}@${domain}`;
  }
}
