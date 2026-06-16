import { timingSafeEqual } from "node:crypto";
import { AppContextResolver } from "../core/context/app-context.resolver.ts";
import { AppAccessGuard } from "../core/guards/app-access.guard.ts";
import { AuthGuard } from "../core/guards/auth.guard.ts";
import { ValidationPipe } from "../core/pipes/validation.pipe.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AppRegistryService } from "../modules/app-registry/app-registry.service.ts";
import { AuthService } from "../modules/auth/auth.service.ts";
import { UserService } from "../modules/user/user.service.ts";
import { AdminSessionStore } from "../services/admin-session-store.ts";
import { CommonTestAccountService } from "../services/common-test-account.service.ts";
import { PublicApiMessageService } from "../services/public-api-message.service.ts";
import { TencentSesEmailCallbackService } from "../services/tencent-ses-email-callback.service.ts";
import { FeedbackService } from "../services/feedback.service.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { AdminSessionRecord, AuthSuccessPayload, ClientType, HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import type { ErrorObject } from "ajv";

const ADMIN_SESSION_COOKIE_NAME = "adminSession";
const ADMIN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface ResolvedAdminBasicAuth {
  username: string;
  password: string;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthorization(
  headerValue?: string,
): { username: string; password: string } | null {
  if (!headerValue || !headerValue.startsWith("Basic ")) {
    return null;
  }
  try {
    const decoded = Buffer.from(headerValue.slice("Basic ".length), "base64").toString("utf8");
    const separatorIndex = decoded.indexOf(":");
    if (separatorIndex <= 0) {
      return null;
    }
    return {
      username: decoded.slice(0, separatorIndex),
      password: decoded.slice(separatorIndex + 1),
    };
  } catch {
    return null;
  }
}

export class BackendRouteContext {
  constructor(
    protected readonly database: ApplicationDatabase,
    protected readonly authService: AuthService,
    protected readonly userService: UserService,
    protected readonly appRegistryService: AppRegistryService,
    protected readonly adminBasicAuth: ResolvedAdminBasicAuth | null,
    protected readonly adminSessionStore: AdminSessionStore,
    protected readonly publicApiMessageService: PublicApiMessageService,
    protected readonly tencentSesEmailCallbackService: TencentSesEmailCallbackService,
    protected readonly feedbackService: FeedbackService,
    protected readonly appContextResolver: AppContextResolver,
    protected readonly authGuard: AuthGuard,
    protected readonly appAccessGuard: AppAccessGuard,
    protected readonly validationPipe: ValidationPipe,
    protected readonly commonTestAccountService: CommonTestAccountService,
  ) {}

  public async authenticate(
    request: HttpRequest,
    options: { requireActiveMembership?: boolean } = {},
  ) {
    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    const explicitAppId = this.appContextResolver.extractExplicitAppId(request);
    if (explicitAppId) {
      this.appAccessGuard.assertScope(explicitAppId, auth.appId);
    }

    await this.authService.assertAccessTokenActive(auth);

    if (options.requireActiveMembership !== false) {
      await this.userService.getById(auth.userId);
      await this.appRegistryService.getAppOrThrow(auth.appId);
      await this.appRegistryService.ensureExistingMembership(
        auth.appId,
        auth.userId,
      );
    }

    return auth;
  }

  public async authenticateProductRequest(
    request: HttpRequest,
    appId: string,
  ) {
    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    this.appAccessGuard.assertScope(appId, auth.appId);
    await this.authService.assertAccessTokenActive(auth);
    return auth;
  }

  public authenticateAdmin(request: HttpRequest): string {
    if (request.adminSession) {
      return request.adminSession.username;
    }

    if (!this.adminBasicAuth) {
      throw new ApplicationError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "Admin authentication is required.",
      );
    }

    const credentials = parseBasicAuthorization(request.headers.authorization);
    if (!credentials) {
      throw new ApplicationError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "Admin authentication is required.",
      );
    }

    return this.validateAdminCredentials(
      credentials.username,
      credentials.password,
    );
  }

  public requireAdminSession(request: HttpRequest): AdminSessionRecord {
    if (!request.adminSession) {
      throw new ApplicationError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "Admin session login is required.",
      );
    }

    return request.adminSession;
  }

  public validateAdminCredentials(username: string, password: string): string {
    if (!this.adminBasicAuth) {
      throw new ApplicationError(
        401,
        "ADMIN_AUTH_REQUIRED",
        "Admin authentication is required.",
      );
    }

    if (
      !safeEqual(username, this.adminBasicAuth.username) ||
      !safeEqual(password, this.adminBasicAuth.password)
    ) {
      throw new ApplicationError(
        401,
        "ADMIN_INVALID_CREDENTIAL",
        "Admin username or password is invalid.",
      );
    }

    return username;
  }

  public async resolveAdminSession(
    request: HttpRequest,
  ): Promise<AdminSessionRecord | null> {
    const sessionId = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (!sessionId) {
      return null;
    }

    return (await this.adminSessionStore.get(sessionId)) ?? null;
  }

  public getClientType(body: Record<string, unknown>): ClientType {
    return body.clientType === "app" ? "app" : "web";
  }

  public requireValidPublicContract<T>(
    result:
      | { ok: true; data: T }
      | { ok: false; errors: string[]; details: ErrorObject[] },
    request?: HttpRequest,
  ): T {
    if (result.ok) {
      return result.data;
    }
    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      this.buildPublicContractValidationMessage(result.details, request),
      { errors: result.errors },
    );
  }

  public buildPublicContractValidationMessage(
    details: ErrorObject[],
    request?: HttpRequest,
  ): string {
    const first = details[0];
    if (!first) {
      return this.publicApiMessageService.format(
        "error.req.invalid_body",
        request,
      );
    }

    if (
      first.keyword === "format" &&
      first.params &&
      "format" in first.params
    ) {
      const format = String((first.params as { format?: string }).format ?? "");
      if (format === "email") {
        return this.publicApiMessageService.format(
          "error.req.invalid_email",
          request,
        );
      }
      if (format === "date-time") {
        return this.publicApiMessageService.format(
          "error.req.invalid_datetime",
          request,
        );
      }
    }

    if (
      first.keyword === "required" &&
      first.params &&
      "missingProperty" in first.params
    ) {
      const missing = String(
        (first.params as { missingProperty?: string }).missingProperty ?? "",
      );
      return this.publicApiMessageService.format(
        "error.req.missing_required",
        request,
        { field: missing },
      );
    }

    if (first.keyword === "enum") {
      return this.publicApiMessageService.format(
        "error.req.invalid_enum",
        request,
      );
    }

    return this.publicApiMessageService.format(
      "error.req.invalid_body",
      request,
    );
  }

  public async toAuthPayload(
    session: {
      userId: string;
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    },
    clientType: ClientType,
  ): Promise<AuthSuccessPayload> {
    const user = await this.userService.getProfile(session.userId);
    return clientType === "app"
      ? {
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          refreshToken: session.refreshToken,
          user,
        }
      : {
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          user,
        };
  }

  public buildAuthHeaders(
    refreshToken: string,
    clientType: ClientType,
  ): Record<string, string> | undefined {
    const cookie = this.authService.buildRefreshCookie(
      refreshToken,
      clientType,
    );
    return cookie ? { "Set-Cookie": cookie } : undefined;
  }

  public buildAdminSessionHeaders(sessionId: string): Record<string, string> {
    return {
      "Set-Cookie": this.buildAdminSessionCookie(
        `${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`,
      ),
    };
  }

  public buildAdminSessionClearHeaders(): Record<string, string> {
    return {
      "Set-Cookie": this.buildAdminSessionCookie(
        `${ADMIN_SESSION_COOKIE_NAME}=`,
        "Max-Age=0",
      ),
    };
  }

  public buildAdminSessionCookie(
    base: string,
    maxAgePart = `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`,
  ): string {
    const parts = [
      base,
      "HttpOnly",
      "Path=/api/v1/admin",
      "SameSite=Lax",
      maxAgePart,
    ];

    if (this.shouldUseSecureAdminCookie()) {
      parts.push("Secure");
    }

    return parts.join("; ");
  }

  public shouldUseSecureAdminCookie(): boolean {
    if (process.env.ADMIN_SESSION_COOKIE_SECURE === "true") {
      return true;
    }

    if (process.env.ADMIN_SESSION_COOKIE_SECURE === "false") {
      return false;
    }

    return process.env.NODE_ENV === "production";
  }

  public requireHeader(request: HttpRequest, headerName: string): string {
    const value = getHeader(request.headers, headerName)?.trim();
    if (!value) {
      throw new ApplicationError(
        400,
        "REQ_INVALID_HEADER",
        `${headerName} header is required.`,
      );
    }

    return value;
  }

  public optionalIntegerHeader(
    request: HttpRequest,
    headerName: string,
  ): number | undefined {
    const rawValue = getHeader(request.headers, headerName)?.trim();
    if (!rawValue) {
      return undefined;
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) {
      throw new ApplicationError(
        400,
        "REQ_INVALID_HEADER",
        `${headerName} header must be a non-negative integer.`,
      );
    }

    return value;
  }

  public requireBinaryBody(body: unknown): Buffer {
    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (body instanceof ArrayBuffer) {
      return Buffer.from(body);
    }

    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      "Request body must be binary.",
    );
  }

  public ok<T>(
    data: T,
    requestId: string,
    headers?: Record<string, string>,
  ): HttpResponse<T> {
    return {
      statusCode: 200,
      headers,
      body: {
        code: "OK",
        message: "success",
        data,
        requestId,
      },
    };
  }
}
