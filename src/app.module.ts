import { timingSafeEqual } from "node:crypto";
import { AppContextResolver } from "./core/context/app-context.resolver.ts";
import { HttpExceptionFilter } from "./core/filters/http-exception.filter.ts";
import { AppAccessGuard } from "./core/guards/app-access.guard.ts";
import { AuthGuard } from "./core/guards/auth.guard.ts";
import { RbacGuard } from "./core/guards/rbac.guard.ts";
import { AuditInterceptor } from "./core/interceptors/audit.interceptor.ts";
import { RequestLoggingInterceptor } from "./core/interceptors/request-logging.interceptor.ts";
import { ValidationPipe } from "./core/pipes/validation.pipe.ts";
import { InMemoryCache } from "./infrastructure/cache/redis/in-memory-cache.ts";
import { buildDefaultSeed } from "./infrastructure/database/prisma/default-seed.ts";
import { InMemoryDatabase } from "./infrastructure/database/prisma/in-memory-database.ts";
import { StorageService } from "./infrastructure/files/storage.service.ts";
import { InMemoryKVBackend, KVManager, type KVBackend } from "./infrastructure/kv/kv-manager.ts";
import { ManagedStateStore, applyManagedState } from "./infrastructure/kv/managed-state.store.ts";
import { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { AnalyticsService } from "./modules/analytics/analytics.service.ts";
import { AdminConsoleService } from "./modules/admin/admin-console.service.ts";
import { AppRegistryService } from "./modules/app-registry/app-registry.service.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { DevelopmentPasswordHasher } from "./modules/auth/password-hasher.ts";
import { QrLoginService } from "./modules/auth/qr-login.service.ts";
import { TokenService } from "./modules/auth/token.service.ts";
import { RbacService } from "./modules/iam/rbac.service.ts";
import { UserService } from "./modules/user/user.service.ts";
import { AppConfigService } from "./services/app-config.service.ts";
import { BailianOpenAICompatibleProvider } from "./services/bailian-openai-compatible-provider.ts";
import { CommonEmailConfigService } from "./services/common-email-config.service.ts";
import { FailedEventRetryService } from "./services/failed-event-retry.service.ts";
import { LLMManager } from "./services/llm-manager.ts";
import { NotificationService } from "./services/notification.service.ts";
import { NoopRegistrationEmailSender, type RegistrationEmailSender, TencentSesRegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";
import { ApplicationError } from "./shared/errors.ts";
import type { AdminEmailServiceDocument, AnalyticsEventInput, ClientType, DatabaseSeed, HttpRequest, HttpResponse, Platform } from "./shared/types.ts";
import { parseCookies, randomId } from "./shared/utils.ts";

export interface CreateApplicationOptions {
  seed?: DatabaseSeed;
  serviceName?: string;
  emitLogs?: boolean;
  registrationCodeGenerator?: () => string;
  registrationEmailSender?: RegistrationEmailSender;
  kvBackend?: KVBackend;
  kvManager?: KVManager;
  adminBasicAuth?: {
    username: string;
    password: string;
  };
}

interface ResolvedAdminBasicAuth {
  username: string;
  password: string;
}

function resolveAdminBasicAuth(options: CreateApplicationOptions): ResolvedAdminBasicAuth | null {
  const username = options.adminBasicAuth?.username ?? process.env.ADMIN_BASIC_AUTH_USERNAME ?? "";
  const password = options.adminBasicAuth?.password ?? process.env.ADMIN_BASIC_AUTH_PASSWORD ?? "";

  if (!username && !password) {
    return null;
  }

  if (!username || !password) {
    throw new Error("ADMIN_BASIC_AUTH_USERNAME and ADMIN_BASIC_AUTH_PASSWORD must be configured together.");
  }

  return {
    username,
    password,
  };
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthorization(headerValue?: string): { username: string; password: string } | null {
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

/**
 * BackendApplication wires the documented modules into a minimal executable runtime.
 */
export class BackendApplication {
  constructor(
    private readonly authService: AuthService,
    private readonly qrLoginService: QrLoginService,
    private readonly analyticsService: AnalyticsService,
    private readonly adminConsoleService: AdminConsoleService,
    private readonly adminBasicAuth: ResolvedAdminBasicAuth | null,
    private readonly llmManager: LLMManager,
    private readonly storageService: StorageService,
    private readonly notificationService: NotificationService,
    private readonly failedEventRetryService: FailedEventRetryService,
    private readonly auditInterceptor: AuditInterceptor,
    private readonly requestLoggingInterceptor: RequestLoggingInterceptor,
    private readonly httpExceptionFilter: HttpExceptionFilter,
    private readonly appContextResolver: AppContextResolver,
    private readonly authGuard: AuthGuard,
    private readonly appAccessGuard: AppAccessGuard,
    private readonly rbacGuard: RbacGuard,
    private readonly validationPipe: ValidationPipe,
  ) {}

  async handle(request: HttpRequest): Promise<HttpResponse<unknown>> {
    request.requestId ??= randomId("req");
    request.cookies ??= parseCookies(request.headers.cookie);
    const startedAt = Date.now();

    try {
      const response = await this.dispatch(request);
      this.requestLoggingInterceptor.log(request, response, Date.now() - startedAt);
      return response;
    } catch (error) {
      const response = this.httpExceptionFilter.catch(error, request.requestId);
      this.requestLoggingInterceptor.log(request, response, Date.now() - startedAt, error);
      return response;
    }
  }

  get runtimeServices() {
    return {
      authService: this.authService,
      qrLoginService: this.qrLoginService,
      analyticsService: this.analyticsService,
      adminConsoleService: this.adminConsoleService,
      llmManager: this.llmManager,
      storageService: this.storageService,
      notificationService: this.notificationService,
      failedEventRetryService: this.failedEventRetryService,
    };
  }

  private async dispatch(request: HttpRequest): Promise<HttpResponse<unknown>> {
    if (request.method === "GET" && request.path === "/api/health") {
      return this.ok({ status: "ok" }, request.requestId as string);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/bootstrap") {
      return this.handleAdminBootstrap(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/email-service") {
      return this.handleAdminGetEmailService(request);
    }

    if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/email-service") {
      return this.handleAdminUpdateEmailService(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/apps") {
      return this.handleAdminCreateApp(request);
    }

    const adminAppMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)$/);
    if (request.method === "DELETE" && adminAppMatch) {
      return this.handleAdminDeleteApp(request, decodeURIComponent(adminAppMatch[1] as string));
    }

    const adminConfigMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/config$/);
    if (request.method === "GET" && adminConfigMatch) {
      return this.handleAdminGetConfig(request, decodeURIComponent(adminConfigMatch[1] as string));
    }

    if (request.method === "PUT" && adminConfigMatch) {
      return this.handleAdminUpdateConfig(request, decodeURIComponent(adminConfigMatch[1] as string));
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login") {
      return this.handleLogin(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register/email-code") {
      return this.handleRegisterEmailCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register") {
      return this.handleRegister(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/qr-logins") {
      return this.handleCreateQrLogin(request);
    }

    const qrLoginConfirmMatch = request.path.match(/^\/api\/v1\/auth\/qr-logins\/([^/]+)\/confirm$/);
    if (request.method === "POST" && qrLoginConfirmMatch) {
      return this.handleConfirmQrLogin(request, decodeURIComponent(qrLoginConfirmMatch[1] as string));
    }

    const qrLoginPollMatch = request.path.match(/^\/api\/v1\/auth\/qr-logins\/([^/]+)$/);
    if (request.method === "GET" && qrLoginPollMatch) {
      return this.handlePollQrLogin(request, decodeURIComponent(qrLoginPollMatch[1] as string));
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/refresh") {
      return this.handleRefresh(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/logout") {
      return this.handleLogout(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/analytics/events/batch") {
      return this.handleAnalyticsBatch(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/metrics/overview") {
      return this.handleMetricsOverview(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/metrics/pages") {
      return this.handleMetricsPages(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/files/presign") {
      return this.handleFilePresign(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/files/confirm") {
      return this.handleFileConfirm(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/notifications/send") {
      return this.handleNotification(request);
    }

    throw new ApplicationError(404, "REQ_INVALID_BODY", "Route not found.");
  }

  private handleLogin(request: HttpRequest): HttpResponse<unknown> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const account = this.validationPipe.requireString(body, "account");
    const password = this.validationPipe.requireString(body, "password");
    const clientType = this.getClientType(body);
    const session = this.authService.login({ appId, account, password });

    this.auditInterceptor.record({
      appId: session.appId,
      actorUserId: session.userId,
      action: "auth.login",
      resourceType: "user_session",
      resourceOwnerUserId: session.userId,
      payload: {
        clientType,
      },
    });

    return this.ok(
      this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  }

  private async handleRegisterEmailCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const result = await this.authService.registerEmailCode({
        appId,
        email,
        ipAddress,
      });

      this.auditInterceptor.record({
        appId,
        action: "auth.register.email_code",
        resourceType: "user_registration",
        payload: {
          email,
          ipAddress,
          accepted: true,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.register.email_code",
        resourceType: "user_registration",
        payload: {
          email,
          ipAddress,
          accepted: false,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private handleRegister(request: HttpRequest): HttpResponse<unknown> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const password = this.validationPipe.requireString(body, "password");
    const emailCode = this.validationPipe.requireString(body, "emailCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const session = this.authService.register({
        appId,
        email,
        password,
        emailCode,
        ipAddress,
      });

      this.auditInterceptor.record({
        appId: session.appId,
        actorUserId: session.userId,
        action: "auth.register",
        resourceType: "user",
        resourceId: session.userId,
        resourceOwnerUserId: session.userId,
        payload: {
          email,
          clientType,
          ipAddress,
        },
      });

      return this.ok(
        this.toAuthPayload(session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(session.refreshToken, clientType),
      );
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.register",
        resourceType: "user_registration",
        payload: {
          email,
          clientType,
          ipAddress,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private handleCreateQrLogin(request: HttpRequest): HttpResponse<unknown> {
    const appId = this.appContextResolver.resolvePreAuth(request);

    try {
      const result = this.qrLoginService.createSession({ appId });

      this.auditInterceptor.record({
        appId,
        action: "auth.qr_login.create",
        resourceType: "qr_login_session",
        resourceId: result.loginId,
        payload: {
          expiresInSeconds: result.expiresInSeconds,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.qr_login.create",
        resourceType: "qr_login_session",
        payload: {
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private handleConfirmQrLogin(request: HttpRequest, loginId: string): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const scanToken = this.validationPipe.requireString(body, "scanToken");

    try {
      const result = this.qrLoginService.confirm({
        appId,
        loginId,
        scanToken,
        userId: auth.userId,
      });

      this.auditInterceptor.record({
        appId: auth.appId,
        actorUserId: auth.userId,
        action: "auth.qr_login.confirm",
        resourceType: "qr_login_session",
        resourceId: loginId,
        resourceOwnerUserId: auth.userId,
        payload: {
          confirmed: true,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId: auth.appId,
        actorUserId: auth.userId,
        action: "auth.qr_login.confirm",
        resourceType: "qr_login_session",
        resourceId: loginId,
        resourceOwnerUserId: auth.userId,
        payload: {
          confirmed: false,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private handlePollQrLogin(request: HttpRequest, loginId: string): HttpResponse<unknown> {
    const appId = this.appContextResolver.resolvePreAuth(request);
    const pollToken = this.validationPipe.requireQueryString(request.query, "pollToken");

    try {
      const result = this.qrLoginService.poll({
        appId,
        loginId,
        pollToken,
      });

      this.auditInterceptor.record({
        appId,
        action: "auth.qr_login.poll",
        resourceType: "qr_login_session",
        resourceId: loginId,
        payload: {
          status: result.status,
        },
      });

      if (result.status === "CONFIRMED") {
        return this.ok(
          {
            status: "CONFIRMED" as const,
            accessToken: result.accessToken,
            expiresIn: result.expiresIn,
          },
          request.requestId as string,
          this.buildAuthHeaders(result.refreshToken, "web"),
        );
      }

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.qr_login.poll",
        resourceType: "qr_login_session",
        resourceId: loginId,
        payload: {
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private handleRefresh(request: HttpRequest): HttpResponse<unknown> {
    const body = this.validationPipe.asObject(request.body);
    const clientType = this.getClientType(body);
    const session = this.authService.refresh({
      appId: this.validationPipe.optionalString(body, "appId"),
      refreshToken: this.validationPipe.optionalString(body, "refreshToken"),
      cookieRefreshToken: request.cookies?.refreshToken,
    });

    return this.ok(
      this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  }

  private handleLogout(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const requestedAppId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const scope = body.scope === "all" ? "all" : "current";

    this.appAccessGuard.assertScope(requestedAppId, auth.appId);
    const revoked = this.authService.logout(
      {
        appId: requestedAppId,
        scope,
        refreshToken: this.validationPipe.optionalString(body, "refreshToken"),
        cookieRefreshToken: request.cookies?.refreshToken,
      },
      auth,
    );

    this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "auth.logout",
      resourceType: "user_session",
      resourceOwnerUserId: auth.userId,
      payload: {
        scope,
        revoked,
      },
    });

    return this.ok(
      { revoked },
      request.requestId as string,
      {
        "Set-Cookie": "refreshToken=; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=0",
      },
    );
  }

  private handleAnalyticsBatch(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    this.appAccessGuard.assertScope(appId, auth.appId);

    const events = this.validationPipe.requireArray<AnalyticsEventInput>(body, "events");
    const result = this.analyticsService.recordBatch({
      appId: auth.appId,
      userId: auth.userId,
      events,
    });

    return this.ok(result, request.requestId as string);
  }

  private handleMetricsOverview(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const result = this.analyticsService.getOverview(auth.appId, dateFrom, dateTo);

    return this.ok(result, request.requestId as string);
  }

  private handleMetricsPages(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const platform = request.query?.platform as Platform | undefined;
    const result = this.analyticsService.getPageMetrics(auth.appId, dateFrom, dateTo, platform);

    return this.ok(result, request.requestId as string);
  }

  private handleAdminBootstrap(request: HttpRequest): HttpResponse<unknown> {
    const adminUser = this.authenticateAdmin(request);
    const result = this.adminConsoleService.getBootstrap(adminUser);

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminCreateApp(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    const appName = this.validationPipe.optionalString(body, "appName");
    const result = await this.adminConsoleService.createApp(appId, appName);

    this.auditInterceptor.record({
      appId: result.appId,
      action: "admin.app.create",
      resourceType: "app",
      resourceId: result.appId,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminDeleteApp(request: HttpRequest, appId: string): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.deleteApp(appId);

    this.auditInterceptor.record({
      appId,
      action: "admin.app.delete",
      resourceType: "app",
      resourceId: appId,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private handleAdminGetEmailService(request: HttpRequest): HttpResponse<unknown> {
    const adminUser = this.authenticateAdmin(request);
    const result = this.adminConsoleService.getEmailServiceConfig();

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.email_service.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateEmailService(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const result = await this.adminConsoleService.updateEmailServiceConfig(
      body as AdminEmailServiceDocument["config"],
    );

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.email_service.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private handleAdminGetConfig(request: HttpRequest, appId: string): HttpResponse<unknown> {
    const adminUser = this.authenticateAdmin(request);
    const result = this.adminConsoleService.getConfig(appId);

    this.auditInterceptor.record({
      appId,
      action: "admin.config.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateConfig(request: HttpRequest, appId: string): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const rawJson = this.validationPipe.requireString(body, "rawJson");
    const result = await this.adminConsoleService.updateConfig(appId, rawJson);

    this.auditInterceptor.record({
      appId,
      action: "admin.config.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private handleFilePresign(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    this.appAccessGuard.assertScope(appId, auth.appId);

    const result = this.storageService.presignUpload({
      appId: auth.appId,
      ownerUserId: auth.userId,
      fileName: this.validationPipe.requireString(body, "fileName"),
      mimeType: this.validationPipe.requireString(body, "mimeType"),
      sizeBytes: this.validationPipe.requireNumber(body, "sizeBytes"),
    });

    return this.ok(result, request.requestId as string);
  }

  private handleFileConfirm(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    this.appAccessGuard.assertScope(appId, auth.appId);

    const result = this.storageService.confirmUpload({
      appId: auth.appId,
      ownerUserId: auth.userId,
      storageKey: this.validationPipe.requireString(body, "storageKey"),
      mimeType: this.validationPipe.requireString(body, "mimeType"),
      sizeBytes: this.validationPipe.requireNumber(body, "sizeBytes"),
    });

    this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "file.confirm",
      resourceType: "file",
      resourceId: result.storageKey,
      resourceOwnerUserId: auth.userId,
      payload: {
        mimeType: this.validationPipe.requireString(body, "mimeType"),
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private handleNotification(request: HttpRequest): HttpResponse<unknown> {
    const auth = this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    this.appAccessGuard.assertScope(appId, auth.appId);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "notification:send");

    const result = this.notificationService.queueNotification({
      appId: auth.appId,
      recipientUserId: this.validationPipe.requireString(body, "recipientUserId"),
      channel: this.validationPipe.requireString(body, "channel") as "email" | "sms" | "push",
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
    });

    return this.ok(result, request.requestId as string);
  }

  private authenticate(request: HttpRequest) {
    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    const explicitAppId = this.appContextResolver.extractExplicitAppId(request);
    if (explicitAppId) {
      this.appAccessGuard.assertScope(explicitAppId, auth.appId);
    }
    return auth;
  }

  private authenticateAdmin(request: HttpRequest): string {
    if (!this.adminBasicAuth) {
      throw new ApplicationError(401, "ADMIN_BASIC_AUTH_REQUIRED", "Admin basic authentication is required.");
    }

    const credentials = parseBasicAuthorization(request.headers.authorization);
    if (!credentials) {
      throw new ApplicationError(401, "ADMIN_BASIC_AUTH_REQUIRED", "Admin basic authentication is required.");
    }

    if (
      !safeEqual(credentials.username, this.adminBasicAuth.username) ||
      !safeEqual(credentials.password, this.adminBasicAuth.password)
    ) {
      throw new ApplicationError(401, "ADMIN_BASIC_AUTH_REQUIRED", "Admin basic authentication is required.");
    }

    return credentials.username;
  }

  private getClientType(body: Record<string, unknown>): ClientType {
    return body.clientType === "app" ? "app" : "web";
  }

  private toAuthPayload(session: { accessToken: string; refreshToken: string; expiresIn: number }, clientType: ClientType) {
    return clientType === "app"
      ? {
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
          refreshToken: session.refreshToken,
        }
      : {
          accessToken: session.accessToken,
          expiresIn: session.expiresIn,
        };
  }

  private buildAuthHeaders(refreshToken: string, clientType: ClientType): Record<string, string> | undefined {
    const cookie = this.authService.buildRefreshCookie(refreshToken, clientType);
    return cookie ? { "Set-Cookie": cookie } : undefined;
  }

  private ok<T>(data: T, requestId: string, headers?: Record<string, string>): HttpResponse<T> {
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

/**
 * createApplication produces a full runtime context that tests can reuse without real infra.
 */
export async function createApplication(options: CreateApplicationOptions = {}) {
  const passwordHasher = new DevelopmentPasswordHasher();
  const seed = options.seed ?? buildDefaultSeed(passwordHasher);
  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : process.env.REDIS_URL
        ? await KVManager.getShared()
        : await KVManager.create({ backend: new InMemoryKVBackend() }));
  const managedStateStore = new ManagedStateStore(kvManager);
  const database = new InMemoryDatabase(
    applyManagedState(seed, await managedStateStore.load()),
  );
  const cache = new InMemoryCache();
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger(options.serviceName ?? "api", {
    emitToConsole: options.emitLogs ?? false,
  });

  const appConfigService = new AppConfigService(database, cache);
  const commonEmailConfigService = new CommonEmailConfigService(appConfigService);
  const appRegistryService = new AppRegistryService(database, appConfigService);
  const userService = new UserService(database);
  const tokenService = new TokenService("zook-local-secret");
  const registrationEmailSender =
    options.registrationEmailSender ??
    (options.serviceName === "api"
      ? new TencentSesRegistrationEmailSender(commonEmailConfigService)
      : new NoopRegistrationEmailSender());
  const authService = new AuthService(
    database,
    cache,
    userService,
    appRegistryService,
    passwordHasher,
    tokenService,
    registrationEmailSender,
    options.registrationCodeGenerator,
  );
  const qrLoginService = new QrLoginService(cache, appRegistryService, userService, authService);
  const analyticsService = new AnalyticsService(database, appRegistryService);
  const adminConsoleService = new AdminConsoleService(
    database,
    appConfigService,
    commonEmailConfigService,
    managedStateStore,
  );
  const rbacService = new RbacService(database);
  const llmManager = new LLMManager({
    bailian: new BailianOpenAICompatibleProvider(),
  });
  const storageService = new StorageService(database);
  const notificationService = new NotificationService(database, queue, logger);
  const failedEventRetryService = new FailedEventRetryService(database, queue, logger);
  const appContextResolver = new AppContextResolver(
    new Map(
      database.apps
        .filter((item) => item.apiDomain)
        .map((item) => [item.apiDomain as string, item.id]),
    ),
  );
  const authGuard = new AuthGuard(tokenService);
  const appAccessGuard = new AppAccessGuard();
  const rbacGuard = new RbacGuard(rbacService);
  const validationPipe = new ValidationPipe();
  const auditInterceptor = new AuditInterceptor(database);
  const requestLoggingInterceptor = new RequestLoggingInterceptor(logger);
  const httpExceptionFilter = new HttpExceptionFilter();
  const adminBasicAuth = resolveAdminBasicAuth(options);

  const app = new BackendApplication(
    authService,
    qrLoginService,
    analyticsService,
    adminConsoleService,
    adminBasicAuth,
    llmManager,
    storageService,
    notificationService,
    failedEventRetryService,
    auditInterceptor,
    requestLoggingInterceptor,
    httpExceptionFilter,
    appContextResolver,
    authGuard,
    appAccessGuard,
    rbacGuard,
    validationPipe,
  );

  return {
    app,
    database,
    cache,
    queue,
    logger,
    passwordHasher,
    services: {
      appConfigService,
      kvManager,
      commonEmailConfigService,
      appRegistryService,
      userService,
      tokenService,
      authService,
      qrLoginService,
      analyticsService,
      adminConsoleService,
      llmManager,
      rbacService,
      storageService,
      notificationService,
      failedEventRetryService,
      appContextResolver,
      authGuard,
      appAccessGuard,
      rbacGuard,
    },
  };
}
