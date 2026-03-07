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
import { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { AnalyticsService } from "./modules/analytics/analytics.service.ts";
import { AppRegistryService } from "./modules/app-registry/app-registry.service.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { DevelopmentPasswordHasher } from "./modules/auth/password-hasher.ts";
import { TokenService } from "./modules/auth/token.service.ts";
import { RbacService } from "./modules/iam/rbac.service.ts";
import { UserService } from "./modules/user/user.service.ts";
import { AppConfigService } from "./services/app-config.service.ts";
import { FailedEventRetryService } from "./services/failed-event-retry.service.ts";
import { NotificationService } from "./services/notification.service.ts";
import { ApplicationError } from "./shared/errors.ts";
import type { AnalyticsEventInput, ClientType, DatabaseSeed, HttpRequest, HttpResponse, Platform } from "./shared/types.ts";
import { parseCookies, randomId } from "./shared/utils.ts";

export interface CreateApplicationOptions {
  seed?: DatabaseSeed;
  serviceName?: string;
  emitLogs?: boolean;
}

/**
 * BackendApplication wires the documented modules into a minimal executable runtime.
 */
export class BackendApplication {
  constructor(
    private readonly authService: AuthService,
    private readonly analyticsService: AnalyticsService,
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
      analyticsService: this.analyticsService,
      storageService: this.storageService,
      notificationService: this.notificationService,
      failedEventRetryService: this.failedEventRetryService,
    };
  }

  private async dispatch(request: HttpRequest): Promise<HttpResponse<unknown>> {
    if (request.method === "GET" && request.path === "/health") {
      return this.ok({ status: "ok" }, request.requestId as string);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login") {
      return this.handleLogin(request);
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
export function createApplication(options: CreateApplicationOptions = {}) {
  const passwordHasher = new DevelopmentPasswordHasher();
  const seed = options.seed ?? buildDefaultSeed(passwordHasher);
  const database = new InMemoryDatabase(seed);
  const cache = new InMemoryCache();
  const queue = new InMemoryJobQueue();
  const logger = new StructuredLogger(options.serviceName ?? "api", {
    emitToConsole: options.emitLogs ?? false,
  });

  const appConfigService = new AppConfigService(database, cache);
  const appRegistryService = new AppRegistryService(database, appConfigService);
  const userService = new UserService(database);
  const tokenService = new TokenService("zook-local-secret");
  const authService = new AuthService(
    database,
    userService,
    appRegistryService,
    passwordHasher,
    tokenService,
  );
  const analyticsService = new AnalyticsService(database, appRegistryService);
  const rbacService = new RbacService(database);
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

  const app = new BackendApplication(
    authService,
    analyticsService,
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
      appRegistryService,
      userService,
      tokenService,
      authService,
      analyticsService,
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
