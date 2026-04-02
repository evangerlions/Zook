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
import { PostgresDatabase } from "./infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "./infrastructure/database/prisma/default-seed.ts";
import { InMemoryDatabase } from "./infrastructure/database/prisma/in-memory-database.ts";
import { StorageService } from "./infrastructure/files/storage.service.ts";
import { InMemoryKVBackend, KVManager, type KVBackend } from "./infrastructure/kv/kv-manager.ts";
import { ManagedStateStore, applyManagedState } from "./infrastructure/kv/managed-state.store.ts";
import { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { RedisJobQueue } from "./infrastructure/queue/bullmq/redis-queue.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import { resolveRuntimeDatabaseUrl, resolveRuntimeRedisUrl } from "./infrastructure/runtime/runtime-readiness.ts";
import { AnalyticsService } from "./modules/analytics/analytics.service.ts";
import { AdminConsoleService } from "./modules/admin/admin-console.service.ts";
import { AiNovelLlmService } from "./modules/ai-novel/ai-novel-llm.service.ts";
import { AppRegistryService } from "./modules/app-registry/app-registry.service.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { DevelopmentPasswordHasher } from "./modules/auth/password-hasher.ts";
import { QrLoginService } from "./modules/auth/qr-login.service.ts";
import { TokenService } from "./modules/auth/token.service.ts";
import { RbacService } from "./modules/iam/rbac.service.ts";
import { UserService } from "./modules/user/user.service.ts";
import { AppConfigService } from "./services/app-config.service.ts";
import { AppI18nConfigService } from "./services/app-i18n-config.service.ts";
import { AppLogSecretService, APP_LOG_SECRET_READ_OPERATION } from "./services/app-log-secret.service.ts";
import { AdminSensitiveOperationService } from "./services/admin-sensitive-operation.service.ts";
import { BailianOpenAICompatibleProvider } from "./services/bailian-openai-compatible-provider.ts";
import { CommonEmailConfigService } from "./services/common-email-config.service.ts";
import { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import {
  CommonPasswordConfigService,
  PASSWORD_VALUE_READ_OPERATION,
} from "./services/common-password-config.service.ts";
import { EmbeddingManager, type EmbeddingProvider } from "./services/embedding-manager.ts";
import {
  ClientLogUploadService,
  CompositeClientLogEncryptionKeyResolver,
  StaticClientLogEncryptionKeyResolver,
  type ClientLogEncryptionKeyResolver,
} from "./services/client-log-upload.service.ts";
import { EmailTestSendService } from "./services/email-test-send.service.ts";
import { FailedEventRetryService } from "./services/failed-event-retry.service.ts";
import { I18nService } from "./services/i18n.service.ts";
import { LlmHealthService } from "./services/llm-health.service.ts";
import { LlmMetricsService } from "./services/llm-metrics.service.ts";
import { LlmSmokeTestService } from "./services/llm-smoke-test.service.ts";
import { LLMManager, type LLMProvider } from "./services/llm-manager.ts";
import { NotificationService } from "./services/notification.service.ts";
import { AdminSessionStore } from "./services/admin-session-store.ts";
import { PasswordManager } from "./services/password-manager.ts";
import { RefreshTokenStore } from "./services/refresh-token-store.ts";
import { HttpGeoResolver, NoopGeoResolver, type GeoResolver, RequestEmailContextService } from "./services/request-email-context.service.ts";
import { RequestLocaleService } from "./services/request-locale.service.ts";
import { SecretReferenceResolver } from "./services/secret-reference-resolver.ts";
import { NoopRegistrationEmailSender, type RegistrationEmailSender, TencentSesRegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";
import { ApplicationError, isApplicationError } from "./shared/errors.ts";
import type {
  AdminAppSummary,
  AdminAppI18nDocument,
  AdminAppLogSecretRevealDocument,
  AdminEmailServiceDocument,
  AdminEmailTestSendDocument,
  AdminLlmServiceDocument,
  AdminPasswordRevealDocument,
  AdminSessionRecord,
  AdminSensitiveOperationCodeRequestDocument,
  AdminSensitiveOperationGrantDocument,
  AdminPasswordDocument,
  AnalyticsEventInput,
  AuthSuccessPayload,
  ClientType,
  CurrentUserDocument,
  DatabaseSeed,
  HttpRequest,
  HttpResponse,
  LogPullTaskResult,
  LogUploadResult,
  LlmMetricsRange,
  Platform,
  TencentSesRegion,
} from "./shared/types.ts";
import { createOpaqueToken, getHeader, parseCookies, randomId } from "./shared/utils.ts";

export interface CreateApplicationOptions {
  seed?: DatabaseSeed;
  serviceName?: string;
  emitLogs?: boolean;
  registrationCodeGenerator?: () => string;
  registrationEmailSender?: RegistrationEmailSender;
  llmProviders?: Record<string, LLMProvider>;
  embeddingProviders?: Record<string, EmbeddingProvider>;
  kvBackend?: KVBackend;
  kvManager?: KVManager;
  geoResolver?: GeoResolver;
  logEncryptionKeys?: Record<string, string>;
  logEncryptionKeyResolver?: ClientLogEncryptionKeyResolver;
  adminBasicAuth?: {
    username: string;
    password: string;
  };
  adminSensitiveOperation?: {
    recipientEmail?: string;
    locale?: string;
    region?: TencentSesRegion;
    templateName?: string;
    appName?: string;
    codeGenerator?: () => string;
  };
  secureRefreshCookie?: boolean;
  accessTokenSecret?: string;
  accessTokenPreviousSecrets?: string[];
  databaseBackend?: "memory" | "postgres";
  databaseUrl?: string;
  queueBackend?: "memory" | "redis";
  queue?: JobQueue;
  queueRedisUrl?: string;
}

interface ResolvedAdminBasicAuth {
  username: string;
  password: string;
}

const ADMIN_SESSION_COOKIE_NAME = "adminSession";
const ADMIN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

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

function resolveSecureRefreshCookie(options: CreateApplicationOptions): boolean {
  if (typeof options.secureRefreshCookie === "boolean") {
    return options.secureRefreshCookie;
  }

  return options.serviceName === "api" || process.env.NODE_ENV === "production";
}

function resolveAccessTokenSecrets(options: CreateApplicationOptions): { current: string; previous: string[] } {
  const current = options.accessTokenSecret?.trim() || process.env.AUTH_ACCESS_TOKEN_SECRET?.trim() || "";
  const previous = options.accessTokenPreviousSecrets
    ?? process.env.AUTH_ACCESS_TOKEN_PREVIOUS_SECRETS?.split(",").map((item) => item.trim()).filter(Boolean)
    ?? [];

  if (current) {
    return {
      current,
      previous,
    };
  }

  if (options.serviceName === "api") {
    throw new Error("AUTH_ACCESS_TOKEN_SECRET must be configured before starting the API service.");
  }

  return {
    current: createOpaqueToken("atk_secret"),
    previous: previous.filter(Boolean),
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
    private readonly database: InMemoryDatabase,
    private readonly authService: AuthService,
    private readonly qrLoginService: QrLoginService,
    private readonly analyticsService: AnalyticsService,
    private readonly adminConsoleService: AdminConsoleService,
    private readonly appRegistryService: AppRegistryService,
    private readonly userService: UserService,
    private readonly adminBasicAuth: ResolvedAdminBasicAuth | null,
    private readonly adminSessionStore: AdminSessionStore,
    private readonly appLogSecretService: AppLogSecretService,
    private readonly adminSensitiveOperationService: AdminSensitiveOperationService,
    private readonly llmManager: LLMManager,
    private readonly embeddingManager: EmbeddingManager,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly aiNovelLlmService: AiNovelLlmService,
    private readonly storageService: StorageService,
    private readonly clientLogUploadService: ClientLogUploadService,
    private readonly notificationService: NotificationService,
    private readonly failedEventRetryService: FailedEventRetryService,
    private readonly requestEmailContextService: RequestEmailContextService,
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
    const execute = async () => {
      request.adminSession = await this.resolveAdminSession(request);
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
    };

    if (request.method === "GET" && request.path === "/api/health") {
      return execute();
    }

    return this.database.withExclusiveSession(execute);
  }

  get runtimeServices() {
    return {
      authService: this.authService,
      qrLoginService: this.qrLoginService,
      analyticsService: this.analyticsService,
      adminConsoleService: this.adminConsoleService,
      userService: this.userService,
      appLogSecretService: this.appLogSecretService,
      adminSensitiveOperationService: this.adminSensitiveOperationService,
      llmManager: this.llmManager,
      embeddingManager: this.embeddingManager,
      llmSmokeTestService: this.llmSmokeTestService,
      aiNovelLlmService: this.aiNovelLlmService,
      storageService: this.storageService,
      clientLogUploadService: this.clientLogUploadService,
      notificationService: this.notificationService,
      failedEventRetryService: this.failedEventRetryService,
    };
  }

  private async dispatch(request: HttpRequest): Promise<HttpResponse<unknown>> {
    if (request.method === "GET" && request.path === "/api/health") {
      return this.ok({ status: "ok" }, request.requestId as string);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/auth/login") {
      return this.handleAdminLogin(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/auth/logout") {
      return this.handleAdminLogout(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/bootstrap") {
      return this.handleAdminBootstrap(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/sensitive-operations/request-code") {
      return this.handleAdminRequestSensitiveOperationCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/sensitive-operations/verify") {
      return this.handleAdminVerifySensitiveOperationCode(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/email-service") {
      return this.handleAdminGetEmailService(request);
    }

    if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/email-service") {
      return this.handleAdminUpdateEmailService(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/email-service/test-send") {
      return this.handleAdminSendTestEmail(request);
    }

    const adminEmailRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/email-service\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminEmailRevisionMatch) {
      return this.handleAdminGetEmailServiceRevision(
        request,
        Number(adminEmailRevisionMatch[1]),
      );
    }

    const adminEmailRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/email-service\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminEmailRestoreMatch) {
      return this.handleAdminRestoreEmailServiceRevision(
        request,
        Number(adminEmailRestoreMatch[1]),
      );
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/passwords") {
      return this.handleAdminGetPasswords(request);
    }

    if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/passwords") {
      return this.handleAdminUpdatePasswords(request);
    }

    if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/passwords/item") {
      return this.handleAdminUpsertPasswordItem(request);
    }

    const adminPasswordRevealMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/passwords\/([^/]+)\/reveal$/,
    );
    if (request.method === "POST" && adminPasswordRevealMatch) {
      return this.handleAdminRevealPasswordValue(request, decodeURIComponent(adminPasswordRevealMatch[1]));
    }

    const adminPasswordDeleteMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/passwords\/([^/]+)$/,
    );
    if (request.method === "DELETE" && adminPasswordDeleteMatch) {
      return this.handleAdminDeletePasswordItem(request, decodeURIComponent(adminPasswordDeleteMatch[1]));
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/llm-service") {
      return this.handleAdminGetLlmService(request);
    }

    if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/llm-service") {
      return this.handleAdminUpdateLlmService(request);
    }

    const adminLlmRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/llm-service\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminLlmRevisionMatch) {
      return this.handleAdminGetLlmServiceRevision(
        request,
        Number(adminLlmRevisionMatch[1]),
      );
    }

    const adminLlmRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/llm-service\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminLlmRestoreMatch) {
      return this.handleAdminRestoreLlmServiceRevision(
        request,
        Number(adminLlmRestoreMatch[1]),
      );
    }

    if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/llm-service/metrics") {
      return this.handleAdminGetLlmMetrics(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/llm-service/smoke-test") {
      return this.handleAdminRunLlmSmokeTest(request);
    }

    const adminLlmModelMetricsMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/common\/llm-service\/metrics\/models\/([^/]+)$/,
    );
    if (request.method === "GET" && adminLlmModelMetricsMatch) {
      return this.handleAdminGetLlmModelMetrics(
        request,
        decodeURIComponent(adminLlmModelMetricsMatch[1] as string),
      );
    }

    if (request.method === "POST" && request.path === "/api/v1/admin/apps") {
      return this.handleAdminCreateApp(request);
    }

    const adminAppNamesMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/names$/);
    if (request.method === "PUT" && adminAppNamesMatch) {
      return this.handleAdminUpdateAppNames(request, decodeURIComponent(adminAppNamesMatch[1] as string));
    }

    const adminAppMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)$/);
    if (request.method === "DELETE" && adminAppMatch) {
      return this.handleAdminDeleteApp(request, decodeURIComponent(adminAppMatch[1] as string));
    }

    const adminAppLogSecretRevealMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/log-secret\/reveal$/,
    );
    if (request.method === "POST" && adminAppLogSecretRevealMatch) {
      return this.handleAdminRevealAppLogSecret(
        request,
        decodeURIComponent(adminAppLogSecretRevealMatch[1] as string),
      );
    }

    const adminI18nSettingsMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings$/);
    if (request.method === "GET" && adminI18nSettingsMatch) {
      return this.handleAdminGetI18nSettings(request, decodeURIComponent(adminI18nSettingsMatch[1] as string));
    }

    if (request.method === "PUT" && adminI18nSettingsMatch) {
      return this.handleAdminUpdateI18nSettings(request, decodeURIComponent(adminI18nSettingsMatch[1] as string));
    }

    const adminI18nRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminI18nRevisionMatch) {
      return this.handleAdminGetI18nSettingsRevision(
        request,
        decodeURIComponent(adminI18nRevisionMatch[1] as string),
        Number(adminI18nRevisionMatch[2]),
      );
    }

    const adminI18nRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminI18nRestoreMatch) {
      return this.handleAdminRestoreI18nSettingsRevision(
        request,
        decodeURIComponent(adminI18nRestoreMatch[1] as string),
        Number(adminI18nRestoreMatch[2]),
      );
    }

    const adminConfigMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/config$/);
    if (request.method === "GET" && adminConfigMatch) {
      return this.handleAdminGetConfig(request, decodeURIComponent(adminConfigMatch[1] as string));
    }

    if (request.method === "PUT" && adminConfigMatch) {
      return this.handleAdminUpdateConfig(request, decodeURIComponent(adminConfigMatch[1] as string));
    }

    const adminConfigRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/config\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminConfigRevisionMatch) {
      return this.handleAdminGetConfigRevision(
        request,
        decodeURIComponent(adminConfigRevisionMatch[1] as string),
        Number(adminConfigRevisionMatch[2]),
      );
    }

    const adminConfigRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/config\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminConfigRestoreMatch) {
      return this.handleAdminRestoreConfigRevision(
        request,
        decodeURIComponent(adminConfigRestoreMatch[1] as string),
        Number(adminConfigRestoreMatch[2]),
      );
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login") {
      return this.handleLogin(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login/email-code") {
      return this.handleLoginEmailCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login/email") {
      return this.handleLoginWithEmailCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/email-code") {
      return this.handleSendPasswordCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/reset") {
      return this.handleResetPassword(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/change") {
      return this.handleChangePassword(request);
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

    if (request.method === "GET" && request.path === "/api/v1/users/me") {
      return this.handleGetCurrentUser(request);
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

    if (request.method === "POST" && request.path === "/api/v1/ai_novel/ai/chat-completions") {
      return this.handleAiNovelChatCompletions(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/ai_novel/ai/embeddings") {
      return this.handleAiNovelEmbeddings(request);
    }

    if (request.method === "GET" && request.path === "/api/v1/logs/pull-task") {
      return this.handleLogsPullTask(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/logs/upload") {
      return this.handleLogsUpload(request);
    }

    throw new ApplicationError(404, "REQ_INVALID_BODY", "Route not found.");
  }

  private async handleLogin(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const account = this.validationPipe.requireString(body, "account");
    const password = this.validationPipe.requireString(body, "password");
    const clientType = this.getClientType(body);
    const session = await this.authService.login({ appId, account, password });

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
    const emailContext = await this.requestEmailContextService.resolve(request);

    try {
      const result = await this.authService.registerEmailCode({
        appId,
        email,
        ipAddress,
        locale: emailContext.locale,
        region: emailContext.region,
      });

      this.auditInterceptor.record({
        appId,
        action: "auth.register.email_code",
        resourceType: "user_registration",
        payload: {
          email,
          ipAddress,
          accepted: true,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
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
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleLoginEmailCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const ipAddress = request.ipAddress ?? "unknown";
    const emailContext = await this.requestEmailContextService.resolve(request);

    try {
      const result = await this.authService.loginEmailCode({
        appId,
        email,
        ipAddress,
        locale: emailContext.locale,
        region: emailContext.region,
      });

      this.auditInterceptor.record({
        appId,
        action: "auth.login.email_code",
        resourceType: "user_login",
        payload: {
          email,
          ipAddress,
          accepted: true,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.login.email_code",
        resourceType: "user_login",
        payload: {
          email,
          ipAddress,
          accepted: false,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleLoginWithEmailCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const emailCode = this.validationPipe.requireString(body, "emailCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";
    const emailContext = await this.requestEmailContextService.resolve(request);

    try {
      const result = await this.authService.loginWithEmailCode({
        appId,
        email,
        emailCode,
        ipAddress,
      });

      this.auditInterceptor.record({
        appId: result.session.appId,
        actorUserId: result.session.userId,
        action: "auth.login.email",
        resourceType: "user_session",
        resourceId: result.session.userId,
        resourceOwnerUserId: result.session.userId,
        payload: {
          email,
          clientType,
          ipAddress,
          autoCreatedUser: result.autoCreatedUser,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
        },
      });

      return this.ok(
        this.toAuthPayload(result.session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(result.session.refreshToken, clientType),
      );
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.login.email",
        resourceType: "user_login",
        payload: {
          email,
          clientType,
          ipAddress,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleSendPasswordCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const ipAddress = request.ipAddress ?? "unknown";
    const emailContext = await this.requestEmailContextService.resolve(request);

    try {
      const result = await this.authService.sendPasswordCode({
        appId,
        email,
        ipAddress,
        locale: emailContext.locale,
        region: emailContext.region,
      });

      this.auditInterceptor.record({
        appId,
        action: "auth.password.email_code",
        resourceType: "user_password_reset",
        payload: {
          email,
          ipAddress,
          accepted: true,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      this.auditInterceptor.record({
        appId,
        action: "auth.password.email_code",
        resourceType: "user_password_reset",
        payload: {
          email,
          ipAddress,
          accepted: false,
          resolvedLocale: emailContext.locale,
          localeSource: emailContext.localeSource,
          resolvedCountryCode: emailContext.countryCode,
          countrySource: emailContext.countrySource,
          resolvedRegion: emailContext.region,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleResetPassword(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const password = this.validationPipe.requireString(body, "password");
    const emailCode = this.validationPipe.requireString(body, "emailCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const session = await this.authService.resetPassword({
        appId,
        email,
        password,
        emailCode,
        ipAddress,
      });

      this.auditInterceptor.record({
        appId: session.appId,
        actorUserId: session.userId,
        action: "auth.password.reset",
        resourceType: "user_session",
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
        action: "auth.password.reset",
        resourceType: "user_password_reset",
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

  private async handleChangePassword(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const requestedAppId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const currentPassword = this.validationPipe.requireString(body, "currentPassword");
    const newPassword = this.validationPipe.requireString(body, "newPassword");
    const clientType = this.getClientType(body);

    this.appAccessGuard.assertScope(requestedAppId, auth.appId);
    const session = await this.authService.changePassword({
      appId: requestedAppId,
      userId: auth.userId,
      currentPassword,
      newPassword,
    });

    this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "auth.password.change",
      resourceType: "user_session",
      resourceOwnerUserId: auth.userId,
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

  private async handleRegister(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const email = this.validationPipe.requireString(body, "email");
    const password = this.validationPipe.requireString(body, "password");
    const emailCode = this.validationPipe.requireString(body, "emailCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const session = await this.authService.register({
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

  private async handleConfirmQrLogin(request: HttpRequest, loginId: string): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const scanToken = this.validationPipe.requireString(body, "scanToken");

    try {
      const result = await this.qrLoginService.confirm({
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

  private async handlePollQrLogin(request: HttpRequest, loginId: string): Promise<HttpResponse<unknown>> {
    const appId = this.appContextResolver.resolvePreAuth(request);
    const pollToken = this.validationPipe.requireQueryString(request.query, "pollToken");

    try {
      const result = await this.qrLoginService.poll({
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
            ...this.toAuthPayload(result, "web"),
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

  private async handleRefresh(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const clientType = this.getClientType(body);
    const session = await this.authService.refresh({
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

  private async handleGetCurrentUser(request: HttpRequest): Promise<HttpResponse<CurrentUserDocument>> {
    const auth = await this.authenticate(request);
    const appId = this.appContextResolver.resolvePostAuth(request, auth.appId);
    const result: CurrentUserDocument = {
      appId,
      user: this.userService.getProfile(auth.userId),
    };

    this.auditInterceptor.record({
      appId,
      actorUserId: auth.userId,
      action: "user.profile.read_self",
      resourceType: "user",
      resourceId: auth.userId,
      resourceOwnerUserId: auth.userId,
      payload: {
        self: true,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleLogout(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request, { requireActiveMembership: false });
    const body = this.validationPipe.asObject(request.body);
    const requestedAppId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const scope = body.scope === "all" ? "all" : "current";

    this.appAccessGuard.assertScope(requestedAppId, auth.appId);
    const revoked = await this.authService.logout(
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
        "Set-Cookie": this.authService.buildClearRefreshCookie(),
      },
    );
  }

  private async handleAnalyticsBatch(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
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

  private async handleMetricsOverview(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const result = this.analyticsService.getOverview(auth.appId, dateFrom, dateTo);

    return this.ok(result, request.requestId as string);
  }

  private async handleMetricsPages(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const platform = request.query?.platform as Platform | undefined;
    const result = this.analyticsService.getPageMetrics(auth.appId, dateFrom, dateTo, platform);

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminLogin(request: HttpRequest): Promise<HttpResponse<unknown>> {
    if (!this.adminBasicAuth) {
      throw new ApplicationError(401, "ADMIN_AUTH_REQUIRED", "Admin authentication is required.");
    }

    const body = this.validationPipe.asObject(request.body);
    const username = this.validationPipe.requireString(body, "username");
    const password = this.validationPipe.requireString(body, "password");
    const adminUser = this.validateAdminCredentials(username, password);
    const session = await this.adminSessionStore.create(adminUser, ADMIN_SESSION_TTL_MS);
    const bootstrap = this.adminConsoleService.getBootstrap(adminUser);

    return this.ok(
      {
        ...bootstrap,
        sessionExpiresAt: session.expiresAt,
      },
      request.requestId as string,
      this.buildAdminSessionHeaders(session.id),
    );
  }

  private async handleAdminLogout(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const sessionId = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (sessionId) {
      await this.adminSessionStore.delete(sessionId);
    }

    return this.ok(
      { loggedOut: true },
      request.requestId as string,
      this.buildAdminSessionClearHeaders(),
    );
  }

  private handleAdminBootstrap(request: HttpRequest): HttpResponse<unknown> {
    const adminUser = this.authenticateAdmin(request);
    const result = this.adminConsoleService.getBootstrap(adminUser);

    return this.ok(
      {
        ...result,
        sessionExpiresAt: request.adminSession?.expiresAt,
      },
      request.requestId as string,
    );
  }

  private async handleAdminRequestSensitiveOperationCode(
    request: HttpRequest,
  ): Promise<HttpResponse<AdminSensitiveOperationCodeRequestDocument>> {
    const session = this.requireAdminSession(request);
    const body = this.validationPipe.asObject(request.body);
    const operation = this.validationPipe.requireString(body, "operation");
    const result = await this.adminSensitiveOperationService.requestCode(session, operation);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.sensitive_operation.request_code",
      resourceType: "sensitive_operation",
      resourceId: result.operation,
      payload: {
        adminUser: session.username,
        recipientEmailMasked: result.recipientEmailMasked,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminVerifySensitiveOperationCode(
    request: HttpRequest,
  ): Promise<HttpResponse<AdminSensitiveOperationGrantDocument>> {
    const session = this.requireAdminSession(request);
    const body = this.validationPipe.asObject(request.body);
    const operation = this.validationPipe.requireString(body, "operation");
    const code = this.validationPipe.requireString(body, "code");
    const result = await this.adminSensitiveOperationService.verifyCode(session, operation, code);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.sensitive_operation.verify",
      resourceType: "sensitive_operation",
      resourceId: result.operation,
      payload: {
        adminUser: session.username,
        expiresAt: result.expiresAt,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminCreateApp(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    const appNameZhCn = this.validationPipe.requireString(body, "appNameZhCn");
    const appNameEnUs = this.validationPipe.requireString(body, "appNameEnUs");
    const result = await this.adminConsoleService.createApp(appId, appNameZhCn, appNameEnUs);

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

  private async handleAdminUpdateAppNames(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppSummary>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const appNameI18n = this.validationPipe.asObject(body.appNameI18n);
    const result = await this.adminConsoleService.updateAppNames(appId, appNameI18n);

    this.auditInterceptor.record({
      appId,
      action: "admin.app.update_names",
      resourceType: "app",
      resourceId: appId,
      payload: {
        adminUser,
        locales: Object.keys(result.appNameI18n),
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRevealAppLogSecret(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppLogSecretRevealDocument>> {
    const session = this.requireAdminSession(request);
    await this.adminSensitiveOperationService.assertGranted(session, APP_LOG_SECRET_READ_OPERATION);
    const result = await this.adminConsoleService.revealAppLogSecret(appId);

    this.auditInterceptor.record({
      appId,
      action: "admin.app.log_secret.reveal",
      resourceType: "app_log_secret",
      resourceId: result.keyId,
      payload: {
        adminUser: session.username,
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

  private async handleAdminGetEmailService(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getEmailServiceConfig();

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
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.updateEmailServiceConfig(
      body as AdminEmailServiceDocument["config"],
      desc,
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

  private async handleAdminSendTestEmail(request: HttpRequest): Promise<HttpResponse<unknown>> {
    try {
      const adminUser = this.authenticateAdminSuperUser(request);
      const body = this.validationPipe.asObject(request.body);
      const result = await this.adminConsoleService.sendEmailTest({
        recipientEmail: this.validationPipe.requireString(body, "recipientEmail"),
        region: this.validationPipe.requireString(body, "region") as AdminEmailTestSendDocument["sender"]["region"],
        templateId: this.validationPipe.requireNumber(body, "templateId"),
        appName: this.validationPipe.requireString(body, "appName"),
        code: this.validationPipe.requireString(body, "code"),
        expireMinutes: this.validationPipe.requireNumber(body, "expireMinutes"),
      });

      this.auditInterceptor.record({
        appId: "common",
        action: "admin.email_service.test_send",
        resourceType: "app_config",
        resourceId: `${result.template.templateId}:${result.recipientEmail}`,
        payload: {
          adminUser,
          recipientEmail: result.recipientEmail,
          region: result.sender.region,
          templateId: result.template.templateId,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      if (isApplicationError(error) && error.code === "EMAIL_PROVIDER_REQUEST_FAILED") {
        return {
          statusCode: error.statusCode,
          body: {
            code: error.code,
            message: error.message,
            data: error.details ?? null,
            requestId: request.requestId as string,
          },
        };
      }

      throw error;
    }
  }

  private async handleAdminGetEmailServiceRevision(
    request: HttpRequest,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getEmailServiceConfig(revision);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.email_service.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreEmailServiceRevision(
    request: HttpRequest,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.restoreEmailServiceConfig(revision);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.email_service.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetPasswords(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getPasswordConfig();

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.password.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRevealPasswordValue(
    request: HttpRequest,
    key: string,
  ): Promise<HttpResponse<AdminPasswordRevealDocument>> {
    const session = this.requireAdminSession(request);
    await this.adminSensitiveOperationService.assertGranted(session, PASSWORD_VALUE_READ_OPERATION);
    const result = await this.adminConsoleService.revealPasswordValue(key);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.password.reveal",
      resourceType: "password_item",
      resourceId: key,
      payload: {
        adminUser: session.username,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdatePasswords(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const result = await this.adminConsoleService.updatePasswordConfig(body);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.password.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpsertPasswordItem(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const result = await this.adminConsoleService.upsertPasswordItem(body);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.password.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
        key: typeof body.key === "string" ? body.key : undefined,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminDeletePasswordItem(
    request: HttpRequest,
    key: string,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.deletePasswordItem(key);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.password.delete",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
        key,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetLlmService(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getLlmServiceConfig();

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateLlmService(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.updateLlmServiceConfig(
      body as AdminLlmServiceDocument["config"],
      desc,
    );

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetLlmServiceRevision(
    request: HttpRequest,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getLlmServiceConfig(revision);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreLlmServiceRevision(
    request: HttpRequest,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.restoreLlmServiceConfig(revision);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetLlmMetrics(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const range = this.parseLlmMetricsRange(request.query?.range);
    const result = await this.adminConsoleService.getLlmMetrics(range);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.metrics.read",
      resourceType: "app_config",
      resourceId: `common.llm_service:${range}`,
      payload: {
        adminUser,
        range,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetLlmModelMetrics(
    request: HttpRequest,
    modelKey: string,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const range = this.parseLlmMetricsRange(request.query?.range);
    const result = await this.adminConsoleService.getLlmModelMetrics(modelKey, range);

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.model_metrics.read",
      resourceType: "app_config",
      resourceId: `common.llm_service:${modelKey}:${range}`,
      payload: {
        adminUser,
        modelKey,
        range,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRunLlmSmokeTest(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdminSuperUser(request);
    const result = await this.adminConsoleService.runLlmSmokeTest();

    this.auditInterceptor.record({
      appId: "common",
      action: "admin.llm_service.smoke_test",
      resourceType: "app_config",
      resourceId: "common.llm_service:smoke-test",
      payload: {
        adminUser,
        summary: result.summary,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetConfig(request: HttpRequest, appId: string): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getConfig(appId);

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

  private async handleAdminGetI18nSettings(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppI18nDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getI18nSettings(appId);

    this.auditInterceptor.record({
      appId,
      action: "admin.i18n_settings.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateI18nSettings(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppI18nDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const desc = this.validationPipe.optionalString(body, "desc");
    const config = body.config ?? body;
    const result = await this.adminConsoleService.updateI18nSettings(appId, config, desc);

    this.auditInterceptor.record({
      appId,
      action: "admin.i18n_settings.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: {
        adminUser,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetI18nSettingsRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAppI18nDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getI18nSettings(appId, revision);

    this.auditInterceptor.record({
      appId,
      action: "admin.i18n_settings.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreI18nSettingsRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAppI18nDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.restoreI18nSettings(appId, revision);

    this.auditInterceptor.record({
      appId,
      action: "admin.i18n_settings.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private parseLlmMetricsRange(value: string | undefined): LlmMetricsRange {
    if (!value) {
      return "24h";
    }

    if (value === "24h" || value === "7d" || value === "30d") {
      return value;
    }

    throw new ApplicationError(400, "REQ_INVALID_QUERY", `Unsupported range: ${value}.`);
  }

  private authenticateAdminSuperUser(request: HttpRequest): string {
    return this.authenticateAdmin(request);
  }

  private async handleAdminUpdateConfig(request: HttpRequest, appId: string): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const rawJson = this.validationPipe.requireString(body, "rawJson");
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.updateConfig(appId, rawJson, desc);

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

  private async handleAdminGetConfigRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getConfig(appId, revision);

    this.auditInterceptor.record({
      appId,
      action: "admin.config.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreConfigRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.restoreConfig(appId, revision);

    this.auditInterceptor.record({
      appId,
      action: "admin.config.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: {
        adminUser,
        revision,
      },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleFilePresign(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
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

  private async handleFileConfirm(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
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

  private async handleNotification(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const appId = this.validationPipe.requireString(body, "appId");
    this.appAccessGuard.assertScope(appId, auth.appId);
    this.rbacGuard.assertPermission(auth.appId, auth.userId, "notification:send");

    const result = await this.notificationService.queueNotification({
      appId: auth.appId,
      recipientUserId: this.validationPipe.requireString(body, "recipientUserId"),
      channel: this.validationPipe.requireString(body, "channel") as "email" | "sms" | "push",
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAiNovelChatCompletions(request: HttpRequest): Promise<HttpResponse<unknown>> {
    await this.authenticateOptionalProductRequest(request, "ai_novel");
    const body = this.validationPipe.asObject(request.body);
    const result = await this.aiNovelLlmService.createChatCompletion(body);
    return this.ok(result, request.requestId as string);
  }

  private async handleAiNovelEmbeddings(request: HttpRequest): Promise<HttpResponse<unknown>> {
    await this.authenticateOptionalProductRequest(request, "ai_novel");
    const body = this.validationPipe.asObject(request.body);
    const result = await this.aiNovelLlmService.createEmbeddings(body);
    return this.ok(result, request.requestId as string);
  }

  private async handleLogsPullTask(request: HttpRequest): Promise<HttpResponse<LogPullTaskResult>> {
    const auth = await this.authenticate(request);
    const result = this.clientLogUploadService.getPullTask(auth);
    return this.ok(result, request.requestId as string);
  }

  private async handleLogsUpload(request: HttpRequest): Promise<HttpResponse<LogUploadResult>> {
    const auth = await this.authenticate(request);
    const result = await this.clientLogUploadService.upload({
      auth,
      taskId: this.requireHeader(request, "x-log-task-id"),
      keyId: this.requireHeader(request, "x-log-key-id"),
      encryption: this.requireHeader(request, "x-log-enc"),
      nonceBase64: this.requireHeader(request, "x-log-nonce"),
      contentEncoding: this.requireHeader(request, "x-log-content"),
      lineCountReported: this.optionalIntegerHeader(request, "x-log-line-count"),
      plainBytesReported: this.optionalIntegerHeader(request, "x-log-plain-bytes"),
      compressedBytesReported: this.optionalIntegerHeader(request, "x-log-compressed-bytes"),
      body: this.requireBinaryBody(request.body),
    });

    this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "logs.upload",
      resourceType: "client_log_upload",
      resourceId: result.taskId,
      resourceOwnerUserId: auth.userId,
      payload: {
        acceptedCount: result.acceptedCount,
        rejectedCount: result.rejectedCount,
      },
    });
    return this.ok(result, request.requestId as string);
  }

  private async authenticate(request: HttpRequest, options: { requireActiveMembership?: boolean } = {}) {
    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    const explicitAppId = this.appContextResolver.extractExplicitAppId(request);
    if (explicitAppId) {
      this.appAccessGuard.assertScope(explicitAppId, auth.appId);
    }

    await this.authService.assertAccessTokenActive(auth);

    if (options.requireActiveMembership !== false) {
      this.userService.getById(auth.userId);
      this.appRegistryService.getAppOrThrow(auth.appId);
      this.appRegistryService.ensureExistingMembership(auth.appId, auth.userId);
    }

    return auth;
  }

  private async authenticateOptionalProductRequest(request: HttpRequest, appId: string) {
    const authorization = getHeader(request.headers, "authorization");
    if (!authorization) {
      const explicitAppId = getHeader(request.headers, "x-app-id");
      if (!explicitAppId) {
        throw new ApplicationError(400, "REQ_INVALID_BODY", "X-App-Id header is required when Authorization is missing.");
      }

      if (explicitAppId !== appId) {
        throw new ApplicationError(403, "AUTH_APP_SCOPE_MISMATCH", `X-App-Id must match ${appId}.`);
      }

      return undefined;
    }

    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    this.appAccessGuard.assertScope(appId, auth.appId);
    await this.authService.assertAccessTokenActive(auth);
    return auth;
  }

  private authenticateAdmin(request: HttpRequest): string {
    if (request.adminSession) {
      return request.adminSession.username;
    }

    if (!this.adminBasicAuth) {
      throw new ApplicationError(401, "ADMIN_AUTH_REQUIRED", "Admin authentication is required.");
    }

    const credentials = parseBasicAuthorization(request.headers.authorization);
    if (!credentials) {
      throw new ApplicationError(401, "ADMIN_AUTH_REQUIRED", "Admin authentication is required.");
    }

    return this.validateAdminCredentials(credentials.username, credentials.password);
  }

  private requireAdminSession(request: HttpRequest): AdminSessionRecord {
    if (!request.adminSession) {
      throw new ApplicationError(401, "ADMIN_AUTH_REQUIRED", "Admin session login is required.");
    }

    return request.adminSession;
  }

  private validateAdminCredentials(username: string, password: string): string {
    if (!this.adminBasicAuth) {
      throw new ApplicationError(401, "ADMIN_AUTH_REQUIRED", "Admin authentication is required.");
    }

    if (
      !safeEqual(username, this.adminBasicAuth.username) ||
      !safeEqual(password, this.adminBasicAuth.password)
    ) {
      throw new ApplicationError(401, "ADMIN_INVALID_CREDENTIAL", "Admin username or password is invalid.");
    }

    return username;
  }

  private async resolveAdminSession(request: HttpRequest): Promise<AdminSessionRecord | null> {
    const sessionId = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (!sessionId) {
      return null;
    }

    return (await this.adminSessionStore.get(sessionId)) ?? null;
  }

  private getClientType(body: Record<string, unknown>): ClientType {
    return body.clientType === "app" ? "app" : "web";
  }

  private toAuthPayload(
    session: { userId: string; accessToken: string; refreshToken: string; expiresIn: number },
    clientType: ClientType,
  ): AuthSuccessPayload {
    const user = this.userService.getProfile(session.userId);
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

  private buildAuthHeaders(refreshToken: string, clientType: ClientType): Record<string, string> | undefined {
    const cookie = this.authService.buildRefreshCookie(refreshToken, clientType);
    return cookie ? { "Set-Cookie": cookie } : undefined;
  }

  private buildAdminSessionHeaders(sessionId: string): Record<string, string> {
    return {
      "Set-Cookie": this.buildAdminSessionCookie(`${ADMIN_SESSION_COOKIE_NAME}=${encodeURIComponent(sessionId)}`),
    };
  }

  private buildAdminSessionClearHeaders(): Record<string, string> {
    return {
      "Set-Cookie": this.buildAdminSessionCookie(`${ADMIN_SESSION_COOKIE_NAME}=`, "Max-Age=0"),
    };
  }

  private buildAdminSessionCookie(base: string, maxAgePart = `Max-Age=${Math.floor(ADMIN_SESSION_TTL_MS / 1000)}`): string {
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

  private shouldUseSecureAdminCookie(): boolean {
    if (process.env.ADMIN_SESSION_COOKIE_SECURE === "true") {
      return true;
    }

    if (process.env.ADMIN_SESSION_COOKIE_SECURE === "false") {
      return false;
    }

    return process.env.NODE_ENV === "production";
  }

  private requireHeader(request: HttpRequest, headerName: string): string {
    const value = getHeader(request.headers, headerName)?.trim();
    if (!value) {
      throw new ApplicationError(400, "REQ_INVALID_HEADER", `${headerName} header is required.`);
    }

    return value;
  }

  private optionalIntegerHeader(request: HttpRequest, headerName: string): number | undefined {
    const rawValue = getHeader(request.headers, headerName)?.trim();
    if (!rawValue) {
      return undefined;
    }

    const value = Number(rawValue);
    if (!Number.isInteger(value) || value < 0) {
      throw new ApplicationError(400, "REQ_INVALID_HEADER", `${headerName} header must be a non-negative integer.`);
    }

    return value;
  }

  private requireBinaryBody(body: unknown): Buffer {
    if (Buffer.isBuffer(body)) {
      return body;
    }

    if (body instanceof Uint8Array) {
      return Buffer.from(body);
    }

    if (body instanceof ArrayBuffer) {
      return Buffer.from(body);
    }

    throw new ApplicationError(400, "REQ_INVALID_BODY", "Request body must be binary.");
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
      : resolveRuntimeRedisUrl()
        ? await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() })
        : await KVManager.create({ backend: new InMemoryKVBackend() }));
  const managedStateStore = new ManagedStateStore(kvManager);
  const databaseBackend = options.databaseBackend ?? "memory";
  const database =
    databaseBackend === "postgres"
      ? await PostgresDatabase.create(
          options.databaseUrl?.trim() || resolveRuntimeDatabaseUrl() || (() => {
            throw new Error("DATABASE_URL must be configured before starting the PostgreSQL database backend.");
          })(),
          seed,
        )
      : new InMemoryDatabase(
          applyManagedState(seed, await managedStateStore.load()),
        );
  const cache = new InMemoryCache();
  const defaultQueueBackend = options.queueRedisUrl?.trim() || resolveRuntimeRedisUrl() ? "redis" : "memory";
  const resolvedQueueBackend = options.queueBackend ?? defaultQueueBackend;
  const queue = options.queue ??
    (resolvedQueueBackend === "redis"
      ? new RedisJobQueue(
          options.queueRedisUrl?.trim() || resolveRuntimeRedisUrl() || (() => {
            throw new Error("REDIS_URL must be configured before starting the Redis job queue backend.");
          })(),
        )
      : new InMemoryJobQueue());
  const logger = new StructuredLogger(options.serviceName ?? "api", {
    emitToConsole: options.emitLogs ?? false,
  });

  const appConfigService = new AppConfigService(database, cache, kvManager);
  const appI18nConfigService = new AppI18nConfigService(appConfigService);
  const passwordManager = new PasswordManager(kvManager);
  const adminSessionStore = new AdminSessionStore(kvManager);
  const refreshTokenStore = new RefreshTokenStore(kvManager);
  const commonPasswordConfigService = new CommonPasswordConfigService(passwordManager);
  const secretReferenceResolver = new SecretReferenceResolver(commonPasswordConfigService);
  const commonEmailConfigService = new CommonEmailConfigService(appConfigService, commonPasswordConfigService, logger);
  const commonLlmConfigService = new CommonLlmConfigService(appConfigService, secretReferenceResolver);
  const appLogSecretService = new AppLogSecretService(database, appConfigService);
  await database.withExclusiveSession(async () => {
    const initializedAppLogSecrets = appLogSecretService.initializeSecrets(database.apps.map((item) => item.id));
    if (initializedAppLogSecrets) {
      await managedStateStore.save(database);
    }
  });
  const llmHealthService = new LlmHealthService(kvManager);
  const llmMetricsService = new LlmMetricsService(kvManager);
  const appRegistryService = new AppRegistryService(database, appConfigService);
  const userService = new UserService(database);
  const accessTokenSecrets = resolveAccessTokenSecrets(options);
  const tokenService = new TokenService(accessTokenSecrets.current, {
    previousSecrets: accessTokenSecrets.previous,
  });
  const registrationEmailSender =
    options.registrationEmailSender ??
    (options.serviceName === "api"
      ? new TencentSesRegistrationEmailSender(commonEmailConfigService)
      : new NoopRegistrationEmailSender());
  const emailTestSendService = new EmailTestSendService(
    commonEmailConfigService,
    kvManager,
    registrationEmailSender,
  );
  const adminSensitiveOperationService = new AdminSensitiveOperationService(
    kvManager,
    registrationEmailSender,
    options.adminSensitiveOperation,
  );
  const geoResolver =
    options.geoResolver ??
    (process.env.GEO_RESOLVER_URL?.trim()
      ? new HttpGeoResolver(
          {
            baseUrl: process.env.GEO_RESOLVER_URL,
            token: process.env.GEO_RESOLVER_TOKEN,
            timeoutMs: Number(process.env.GEO_RESOLVER_TIMEOUT_MS ?? 1500),
          },
          cache,
        )
      : new NoopGeoResolver());
  const requestEmailContextService = new RequestEmailContextService(geoResolver);
  const requestLocaleService = new RequestLocaleService();
  const i18nService = new I18nService(appI18nConfigService, requestLocaleService);
  const authService = new AuthService(
    database,
    kvManager,
    userService,
    appRegistryService,
    passwordHasher,
    tokenService,
    refreshTokenStore,
    registrationEmailSender,
    options.registrationCodeGenerator,
    resolveSecureRefreshCookie(options),
  );
  const qrLoginService = new QrLoginService(cache, appRegistryService, userService, authService);
  const analyticsService = new AnalyticsService(database, appRegistryService);
  const bailianProvider = new BailianOpenAICompatibleProvider();
  const llmProviders = options.llmProviders ?? {
    bailian: bailianProvider,
  };
  const embeddingProviders = options.embeddingProviders ?? {
    bailian: bailianProvider,
  };
  const embeddingManager = new EmbeddingManager(embeddingProviders, undefined, {
    commonLlmConfigService,
    llmHealthService,
    llmMetricsService,
  });
  const llmSmokeTestService = new LlmSmokeTestService(
    commonLlmConfigService,
    kvManager,
    llmProviders,
    embeddingProviders,
  );
  const logEncryptionKeyResolver = new CompositeClientLogEncryptionKeyResolver([
    options.logEncryptionKeyResolver ?? new StaticClientLogEncryptionKeyResolver(options.logEncryptionKeys),
    appLogSecretService,
  ]);
  const adminConsoleService = new AdminConsoleService(
    database,
    appConfigService,
    appI18nConfigService,
    appLogSecretService,
    commonEmailConfigService,
    commonLlmConfigService,
    commonPasswordConfigService,
    emailTestSendService,
    llmHealthService,
    llmMetricsService,
    llmSmokeTestService,
    refreshTokenStore,
    managedStateStore,
  );
  const rbacService = new RbacService(database);
  const llmManager = new LLMManager(llmProviders, undefined, {
    commonLlmConfigService,
    llmHealthService,
    llmMetricsService,
  });
  const aiNovelLlmService = new AiNovelLlmService(llmManager, embeddingManager);
  const storageService = new StorageService(database);
  const clientLogUploadService = new ClientLogUploadService(
    database,
    logEncryptionKeyResolver,
  );
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
    database,
    authService,
    qrLoginService,
    analyticsService,
    adminConsoleService,
    appRegistryService,
    userService,
    adminBasicAuth,
    adminSessionStore,
    appLogSecretService,
    adminSensitiveOperationService,
    llmManager,
    embeddingManager,
    llmSmokeTestService,
    aiNovelLlmService,
    storageService,
    clientLogUploadService,
    notificationService,
    failedEventRetryService,
    requestEmailContextService,
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
      appI18nConfigService,
      kvManager,
      passwordManager,
      adminSessionStore,
      refreshTokenStore,
      commonPasswordConfigService,
      commonEmailConfigService,
      commonLlmConfigService,
      appLogSecretService,
      adminSensitiveOperationService,
      appRegistryService,
      emailTestSendService,
      userService,
      tokenService,
      authService,
      qrLoginService,
      analyticsService,
      adminConsoleService,
      llmManager,
      embeddingManager,
      llmHealthService,
      llmMetricsService,
      llmSmokeTestService,
      aiNovelLlmService,
      rbacService,
      storageService,
      clientLogUploadService,
      notificationService,
      failedEventRetryService,
      requestEmailContextService,
      requestLocaleService,
      i18nService,
      appContextResolver,
      authGuard,
      appAccessGuard,
      rbacGuard,
    },
    close: async () => {
      await queue.close?.();
      await database.close();
    },
  };
}
