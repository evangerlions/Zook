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
import { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import { PostgresDatabase } from "./infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "./infrastructure/database/prisma/default-seed.ts";
import { StorageService } from "./infrastructure/files/storage.service.ts";
import { PersistentFileStore } from "./infrastructure/files/persistent-file-store.ts";
import { InMemoryKVBackend, KVManager, type KVBackend } from "./infrastructure/kv/kv-manager.ts";
import { ManagedStateStore, applyManagedState } from "./infrastructure/kv/managed-state.store.ts";
import { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { RedisJobQueue } from "./infrastructure/queue/bullmq/redis-queue.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import {
  resolveRuntimeDatabaseUrl,
  resolveRuntimeMigrationDatabaseUrl,
  resolveRuntimeRedisUrl,
} from "./infrastructure/runtime/runtime-readiness.ts";
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
import { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";
import { AppI18nConfigService } from "./services/app-i18n-config.service.ts";
import { AppAiRoutingConfigService, AI_NOVEL_APP_ID } from "./services/app-ai-routing-config.service.ts";
import { AppLogSecretService, APP_LOG_SECRET_READ_OPERATION } from "./services/app-log-secret.service.ts";
import { AppRemoteLogPullService } from "./services/app-remote-log-pull.service.ts";
import { AdminSensitiveOperationService } from "./services/admin-sensitive-operation.service.ts";
import { BailianOpenAICompatibleProvider } from "./services/bailian-openai-compatible-provider.ts";
import {
  CommonEmailConfigService,
  TENCENT_SECRET_ID_PASSWORD_KEY,
  TENCENT_SECRET_KEY_PASSWORD_KEY,
} from "./services/common-email-config.service.ts";
import { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import {
  CommonPasswordConfigService,
  PASSWORD_VALUE_READ_OPERATION,
} from "./services/common-password-config.service.ts";
import { EmbeddingManager, type EmbeddingProvider } from "./services/embedding-manager.ts";
import {
  ClientLogUploadService,
  type ClientLogEncryptionKeyResolver,
} from "./services/client-log-upload.service.ts";
import {
  AesGcmPayloadCryptoError,
  AesGcmPayloadCryptoService,
  CompositeAesGcmEncryptionKeyResolver,
  StaticAesGcmEncryptionKeyResolver,
  type AesGcmJsonEnvelope,
} from "./services/aes-gcm-payload-crypto.service.ts";
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
import {
  NoopSmsVerificationSender,
  TencentSmsVerificationSender,
  type SmsVerificationSender,
  type TencentSmsVerificationConfig,
} from "./services/tencent-sms-verification.service.ts";
import {
  NoopCaptchaVerificationService,
  TencentCaptchaVerificationService,
  type CaptchaVerificationService,
  type TencentCaptchaVerificationConfig,
} from "./services/tencent-captcha-verification.service.ts";
import { ApplicationError, isApplicationError } from "./shared/errors.ts";
import type {
  AdminAppSummary,
  AdminAiRoutingDocument,
  AdminAppI18nDocument,
  AdminAppLogSecretRevealDocument,
  AdminAppRemoteLogPullSettingsDocument,
  AdminAppRemoteLogPullTaskListDocument,
  AdminRemoteLogPullTaskDocument,
  AdminRemoteLogPullTaskFileDocument,
  AdminEmailServiceDocument,
  AdminEmailTestSendDocument,
  AdminLlmServiceDocument,
  AdminPasswordRevealDocument,
  PublicAppConfigDocument,
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
  LogNoDataAckResult,
  LogFailResult,
  LogPolicyResult,
  LogPullTaskResult,
  LogUploadResult,
  LlmMetricsRange,
  Platform,
} from "./shared/types.ts";
import { createOpaqueToken, getHeader, parseCookies, randomId } from "./shared/utils.ts";

export interface CreateApplicationOptions {
  seed?: DatabaseSeed;
  serviceName?: string;
  emitLogs?: boolean;
  registrationCodeGenerator?: () => string;
  registrationEmailSender?: RegistrationEmailSender;
  smsVerificationSender?: SmsVerificationSender;
  captchaVerificationService?: CaptchaVerificationService;
  tencentSmsVerificationConfig?: TencentSmsVerificationConfig;
  tencentCaptchaVerificationConfig?: TencentCaptchaVerificationConfig;
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
    secondaryPassword?: string;
  };
  secureRefreshCookie?: boolean;
  refreshCookieSameSite?: "Lax" | "None" | "Strict";
  accessTokenSecret?: string;
  accessTokenPreviousSecrets?: string[];
  databaseUrl?: string;
  migrationDatabaseUrl?: string;
  /**
   * Test-only escape hatch for injecting a database double.
   * Production runtime should rely on PostgreSQL-backed storage.
   */
  database?: ApplicationDatabase;
  /**
   * Test-only factory for constructing a database double from the resolved seed.
   */
  databaseFactory?: (seed: DatabaseSeed) => Promise<ApplicationDatabase> | ApplicationDatabase;
  queueBackend?: "memory" | "redis";
  queue?: JobQueue;
  queueRedisUrl?: string;
  fileStorageRoot?: string;
}

interface ResolvedAdminBasicAuth {
  username: string;
  password: string;
}

const ADMIN_SESSION_COOKIE_NAME = "adminSession";
const ADMIN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_RUNTIME_VERSION = "0.1.0";

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

  const sameSite = resolveRefreshCookieSameSite(options);
  if (sameSite === "None") {
    return true;
  }

  return options.serviceName === "api" || process.env.NODE_ENV === "production";
}

function resolveRefreshCookieSameSite(options: CreateApplicationOptions): "Lax" | "None" | "Strict" {
  const runtimeServiceName = options.serviceName ?? "api";
  const configured = options.refreshCookieSameSite ?? process.env.AUTH_REFRESH_COOKIE_SAMESITE;
  if (configured) {
    const normalized = configured.trim().toLowerCase();
    if (normalized === "lax") {
      return "Lax";
    }
    if (normalized === "none") {
      return "None";
    }
    if (normalized === "strict") {
      return "Strict";
    }

    throw new Error("AUTH_REFRESH_COOKIE_SAMESITE must be one of: Lax, None, Strict.");
  }

  if (runtimeServiceName === "api" || process.env.NODE_ENV === "production") {
    return "None";
  }

  return "Lax";
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

function resolveRuntimeVersion(rawVersion = process.env.APP_VERSION): string {
  const normalized = rawVersion?.trim();
  return normalized || DEFAULT_RUNTIME_VERSION;
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
    private readonly database: ApplicationDatabase,
    private readonly authService: AuthService,
    private readonly qrLoginService: QrLoginService,
    private readonly analyticsService: AnalyticsService,
    private readonly adminConsoleService: AdminConsoleService,
    private readonly appRegistryService: AppRegistryService,
    private readonly userService: UserService,
    private readonly appAiRoutingConfigService: AppAiRoutingConfigService,
    private readonly adminBasicAuth: ResolvedAdminBasicAuth | null,
    private readonly adminSessionStore: AdminSessionStore,
    private readonly appLogSecretService: AppLogSecretService,
    private readonly adminSensitiveOperationService: AdminSensitiveOperationService,
    private readonly llmManager: LLMManager,
    private readonly embeddingManager: EmbeddingManager,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly aiNovelLlmService: AiNovelLlmService,
    private readonly aiPayloadCryptoService: AesGcmPayloadCryptoService,
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
      appAiRoutingConfigService: this.appAiRoutingConfigService,
      appLogSecretService: this.appLogSecretService,
      adminSensitiveOperationService: this.adminSensitiveOperationService,
      llmManager: this.llmManager,
      embeddingManager: this.embeddingManager,
      llmSmokeTestService: this.llmSmokeTestService,
      aiNovelLlmService: this.aiNovelLlmService,
      aiPayloadCryptoService: this.aiPayloadCryptoService,
      storageService: this.storageService,
      clientLogUploadService: this.clientLogUploadService,
      notificationService: this.notificationService,
      failedEventRetryService: this.failedEventRetryService,
    };
  }

  private async dispatch(request: HttpRequest): Promise<HttpResponse<unknown>> {
    if (request.method === "GET" && request.path === "/api/health") {
      return this.ok({ status: "ok", version: resolveRuntimeVersion() }, request.requestId as string);
    }

    const publicConfigMatch = request.path.match(/^\/api\/v1\/([^/]+)\/public\/config$/);
    if (request.method === "GET" && publicConfigMatch) {
      return this.handleGetPublicAppConfig(
        request,
        decodeURIComponent(publicConfigMatch[1] as string),
      );
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

    const adminRemoteLogPullMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull$/);
    if (request.method === "GET" && adminRemoteLogPullMatch) {
      return this.handleAdminGetRemoteLogPullSettings(
        request,
        decodeURIComponent(adminRemoteLogPullMatch[1] as string),
      );
    }

    if (request.method === "PUT" && adminRemoteLogPullMatch) {
      return this.handleAdminUpdateRemoteLogPullSettings(
        request,
        decodeURIComponent(adminRemoteLogPullMatch[1] as string),
      );
    }

    const adminRemoteLogPullRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminRemoteLogPullRevisionMatch) {
      return this.handleAdminGetRemoteLogPullSettingsRevision(
        request,
        decodeURIComponent(adminRemoteLogPullRevisionMatch[1] as string),
        Number(adminRemoteLogPullRevisionMatch[2]),
      );
    }

    const adminRemoteLogPullRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminRemoteLogPullRestoreMatch) {
      return this.handleAdminRestoreRemoteLogPullSettingsRevision(
        request,
        decodeURIComponent(adminRemoteLogPullRestoreMatch[1] as string),
        Number(adminRemoteLogPullRestoreMatch[2]),
      );
    }

    const adminRemoteLogPullTasksMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks$/,
    );
    if (request.method === "GET" && adminRemoteLogPullTasksMatch) {
      return this.handleAdminListRemoteLogPullTasks(
        request,
        decodeURIComponent(adminRemoteLogPullTasksMatch[1] as string),
      );
    }

    if (request.method === "POST" && adminRemoteLogPullTasksMatch) {
      return this.handleAdminCreateRemoteLogPullTask(
        request,
        decodeURIComponent(adminRemoteLogPullTasksMatch[1] as string),
      );
    }

    const adminRemoteLogPullTaskCancelMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)\/cancel$/,
    );
    if (request.method === "POST" && adminRemoteLogPullTaskCancelMatch) {
      return this.handleAdminCancelRemoteLogPullTask(
        request,
        decodeURIComponent(adminRemoteLogPullTaskCancelMatch[1] as string),
        decodeURIComponent(adminRemoteLogPullTaskCancelMatch[2] as string),
      );
    }

    const adminRemoteLogPullTaskFileMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)\/file$/,
    );
    if (request.method === "GET" && adminRemoteLogPullTaskFileMatch) {
      return this.handleAdminGetRemoteLogPullTaskFile(
        request,
        decodeURIComponent(adminRemoteLogPullTaskFileMatch[1] as string),
        decodeURIComponent(adminRemoteLogPullTaskFileMatch[2] as string),
      );
    }

    const adminRemoteLogPullTaskDetailMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/remote-log-pull\/tasks\/([^/]+)$/,
    );
    if (request.method === "GET" && adminRemoteLogPullTaskDetailMatch) {
      return this.handleAdminGetRemoteLogPullTask(
        request,
        decodeURIComponent(adminRemoteLogPullTaskDetailMatch[1] as string),
        decodeURIComponent(adminRemoteLogPullTaskDetailMatch[2] as string),
      );
    }

    const adminAiRoutingMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing$/);
    if (request.method === "GET" && adminAiRoutingMatch) {
      return this.handleAdminGetAiRouting(request, decodeURIComponent(adminAiRoutingMatch[1] as string));
    }

    if (request.method === "PUT" && adminAiRoutingMatch) {
      return this.handleAdminUpdateAiRouting(request, decodeURIComponent(adminAiRoutingMatch[1] as string));
    }

    const adminAiRoutingRevisionMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing\/revisions\/(\d+)$/,
    );
    if (request.method === "GET" && adminAiRoutingRevisionMatch) {
      return this.handleAdminGetAiRoutingRevision(
        request,
        decodeURIComponent(adminAiRoutingRevisionMatch[1] as string),
        Number(adminAiRoutingRevisionMatch[2]),
      );
    }

    const adminAiRoutingRestoreMatch = request.path.match(
      /^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing\/revisions\/(\d+)\/restore$/,
    );
    if (request.method === "POST" && adminAiRoutingRestoreMatch) {
      return this.handleAdminRestoreAiRoutingRevision(
        request,
        decodeURIComponent(adminAiRoutingRestoreMatch[1] as string),
        Number(adminAiRoutingRestoreMatch[2]),
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

    if (request.method === "POST" && request.path === "/api/v1/auth/login/sms-code") {
      return this.handleLoginSmsCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login/email") {
      return this.handleLoginWithEmailCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/login/sms") {
      return this.handleLoginWithSmsCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/email-code") {
      return this.handleSendPasswordCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/sms-code") {
      return this.handleSendPasswordSmsCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/reset") {
      return this.handleResetPassword(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/reset-by-sms") {
      return this.handleResetPasswordBySms(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/change") {
      return this.handleChangePassword(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/password/set") {
      return this.handleSetPassword(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register/email-code") {
      return this.handleRegisterEmailCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register/sms-code") {
      return this.handleRegisterSmsCode(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register") {
      return this.handleRegister(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/auth/register/sms") {
      return this.handleRegisterBySms(request);
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

    if (request.method === "GET" && request.path === "/api/v1/logs/policy") {
      return this.handleLogsPolicy(request);
    }

    if (request.method === "POST" && request.path === "/api/v1/logs/upload") {
      return this.handleLogsUpload(request);
    }

    const logAckMatch = request.path.match(/^\/api\/v1\/logs\/tasks\/([^/]+)\/ack$/);
    if (request.method === "POST" && logAckMatch) {
      return this.handleLogsAckNoData(request, decodeURIComponent(logAckMatch[1]));
    }

    const logFailMatch = request.path.match(/^\/api\/v1\/logs\/tasks\/([^/]+)\/fail$/);
    if (request.method === "POST" && logFailMatch) {
      return this.handleLogsFail(request, decodeURIComponent(logFailMatch[1]));
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

    await this.auditInterceptor.record({
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
      await this.toAuthPayload(session, clientType),
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

      await this.auditInterceptor.record({
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
      await this.auditInterceptor.record({
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

      await this.auditInterceptor.record({
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
      await this.auditInterceptor.record({
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

  private async handleLoginSmsCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const test = this.validationPipe.optionalBoolean(body, "test");
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const result = await this.authService.loginSmsCode({
        appId,
        phone,
        phoneNa,
        test,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId,
        action: "auth.login.sms_code",
        resourceType: "user_login",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: true,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.login.sms_code",
        resourceType: "user_login",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: false,
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

      await this.auditInterceptor.record({
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
        await this.toAuthPayload(result.session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(result.session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
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

  private async handleLoginWithSmsCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const smsCode = this.validationPipe.requireString(body, "smsCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const result = await this.authService.loginWithSmsCode({
        appId,
        phone,
        phoneNa,
        smsCode,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId: result.session.appId,
        actorUserId: result.session.userId,
        action: "auth.login.sms",
        resourceType: "user_session",
        resourceId: result.session.userId,
        resourceOwnerUserId: result.session.userId,
        payload: {
          phone,
          phoneNa,
          clientType,
          ipAddress,
          autoCreatedUser: result.autoCreatedUser,
        },
      });

      return this.ok(
        await this.toAuthPayload(result.session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(result.session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.login.sms",
        resourceType: "user_login",
        payload: {
          phone,
          phoneNa,
          clientType,
          ipAddress,
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

      await this.auditInterceptor.record({
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
      await this.auditInterceptor.record({
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

  private async handleSendPasswordSmsCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const test = this.validationPipe.optionalBoolean(body, "test");
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const result = await this.authService.sendPasswordSmsCode({
        appId,
        phone,
        phoneNa,
        test,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId,
        action: "auth.password.sms_code",
        resourceType: "user_password_reset",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: true,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.password.sms_code",
        resourceType: "user_password_reset",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: false,
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

      await this.auditInterceptor.record({
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
        await this.toAuthPayload(session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
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

  private async handleResetPasswordBySms(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const password = this.validationPipe.requireString(body, "password");
    const smsCode = this.validationPipe.requireString(body, "smsCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const session = await this.authService.resetPasswordBySms({
        appId,
        phone,
        phoneNa,
        password,
        smsCode,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId: session.appId,
        actorUserId: session.userId,
        action: "auth.password.reset_sms",
        resourceType: "user_session",
        resourceId: session.userId,
        resourceOwnerUserId: session.userId,
        payload: {
          phone,
          phoneNa,
          clientType,
          ipAddress,
        },
      });

      return this.ok(
        await this.toAuthPayload(session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.password.reset_sms",
        resourceType: "user_password_reset",
        payload: {
          phone,
          phoneNa,
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

    await this.auditInterceptor.record({
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
      await this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  }

  private async handleSetPassword(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const requestedAppId = this.validationPipe.optionalString(body, "appId") ?? auth.appId;
    const password = this.validationPipe.requireString(body, "password");
    const clientType = this.getClientType(body);

    this.appAccessGuard.assertScope(requestedAppId, auth.appId);
    const session = await this.authService.setPassword({
      appId: requestedAppId,
      userId: auth.userId,
      password,
    });

    await this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "auth.password.set",
      resourceType: "user_session",
      resourceOwnerUserId: auth.userId,
      payload: {
        clientType,
      },
    });

    return this.ok(
      await this.toAuthPayload(session, clientType),
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

      await this.auditInterceptor.record({
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
        await this.toAuthPayload(session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
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

  private async handleRegisterSmsCode(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const test = this.validationPipe.optionalBoolean(body, "test");
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const result = await this.authService.registerSmsCode({
        appId,
        phone,
        phoneNa,
        test,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId,
        action: "auth.register.sms_code",
        resourceType: "user_registration",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: true,
        },
      });

      return this.ok(result, request.requestId as string);
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.register.sms_code",
        resourceType: "user_registration",
        payload: {
          phone,
          phoneNa,
          test,
          ipAddress,
          accepted: false,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleRegisterBySms(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const body = this.validationPipe.asObject(request.body);
    const appId = this.appContextResolver.resolvePreAuth(request);
    const phone = this.validationPipe.requireString(body, "phone");
    const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
    const smsCode = this.validationPipe.requireString(body, "smsCode");
    const clientType = this.getClientType(body);
    const ipAddress = request.ipAddress ?? "unknown";

    try {
      const session = await this.authService.registerWithSms({
        appId,
        phone,
        phoneNa,
        smsCode,
        ipAddress,
      });

      await this.auditInterceptor.record({
        appId: session.appId,
        actorUserId: session.userId,
        action: "auth.register.sms",
        resourceType: "user_session",
        resourceId: session.userId,
        resourceOwnerUserId: session.userId,
        payload: {
          phone,
          phoneNa,
          clientType,
          ipAddress,
        },
      });

      return this.ok(
        await this.toAuthPayload(session, clientType),
        request.requestId as string,
        this.buildAuthHeaders(session.refreshToken, clientType),
      );
    } catch (error) {
      await this.auditInterceptor.record({
        appId,
        action: "auth.register.sms",
        resourceType: "user_registration",
        payload: {
          phone,
          phoneNa,
          clientType,
          ipAddress,
          errorCode: error instanceof ApplicationError ? error.code : "SYS_INTERNAL_ERROR",
        },
      });
      throw error;
    }
  }

  private async handleCreateQrLogin(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const appId = this.appContextResolver.resolvePreAuth(request);

    try {
      const result = await this.qrLoginService.createSession({ appId });

      await this.auditInterceptor.record({
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
      await this.auditInterceptor.record({
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

      await this.auditInterceptor.record({
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
      await this.auditInterceptor.record({
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

      await this.auditInterceptor.record({
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
            ...(await this.toAuthPayload(result, "web")),
          },
          request.requestId as string,
          this.buildAuthHeaders(result.refreshToken, "web"),
        );
      }

      return this.ok(result, request.requestId as string);
    } catch (error) {
      await this.auditInterceptor.record({
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
      await this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  }

  private async handleGetCurrentUser(request: HttpRequest): Promise<HttpResponse<CurrentUserDocument>> {
    const auth = await this.authenticate(request);
    const appId = this.appContextResolver.resolvePostAuth(request, auth.appId);
    const result: CurrentUserDocument = {
      appId,
      user: await this.userService.getProfile(auth.userId),
    };

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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
    const result = await this.analyticsService.recordBatch({
      appId: auth.appId,
      userId: auth.userId,
      events,
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleMetricsOverview(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    await this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const result = await this.analyticsService.getOverview(auth.appId, dateFrom, dateTo);

    return this.ok(result, request.requestId as string);
  }

  private async handleMetricsPages(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const auth = await this.authenticate(request);
    await this.rbacGuard.assertPermission(auth.appId, auth.userId, "metrics:read");

    const requestedAppId = request.query?.appId ?? auth.appId;
    this.appAccessGuard.assertScope(requestedAppId, auth.appId);

    const dateFrom = this.validationPipe.requireQueryString(request.query, "dateFrom");
    const dateTo = this.validationPipe.requireQueryString(request.query, "dateTo");
    const platform = request.query?.platform as Platform | undefined;
    const result = await this.analyticsService.getPageMetrics(auth.appId, dateFrom, dateTo, platform);

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
    const bootstrap = await this.adminConsoleService.getBootstrap(adminUser);

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

  private async handleAdminBootstrap(request: HttpRequest): Promise<HttpResponse<unknown>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getBootstrap(adminUser);

    return this.ok(
      {
        ...result,
        sessionExpiresAt: request.adminSession?.expiresAt,
      },
      request.requestId as string,
    );
  }

  private async handleGetPublicAppConfig(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<PublicAppConfigDocument>> {
    const authorization = getHeader(request.headers, "authorization");
    if (authorization) {
      const auth = this.authGuard.canActivate(request);
      this.appContextResolver.resolvePostAuth(request, auth.appId);
      this.appAccessGuard.assertScope(appId, auth.appId);
      await this.authService.assertAccessTokenActive(auth);
    } else {
      const requestAppId = getHeader(request.headers, "x-app-id");
      if (requestAppId && requestAppId !== appId) {
        throw new ApplicationError(403, "AUTH_APP_SCOPE_MISMATCH", `X-App-Id must match ${appId}.`);
      }
    }

    const result = await this.adminConsoleService.getPublicConfig(appId);
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRequestSensitiveOperationCode(
    request: HttpRequest,
  ): Promise<HttpResponse<AdminSensitiveOperationCodeRequestDocument>> {
    const session = this.requireAdminSession(request);
    const body = this.validationPipe.asObject(request.body);
    const operation = this.validationPipe.requireString(body, "operation");
    const result = await this.adminSensitiveOperationService.requestCode(session, operation);

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

      await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreEmailServiceConfig(revision, desc);

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreLlmServiceConfig(revision, desc);

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

  private async handleAdminGetAiRouting(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAiRoutingDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getAiRouting(appId);

    await this.auditInterceptor.record({
      appId,
      action: "admin.ai_routing.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: { adminUser },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateAiRouting(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAiRoutingDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const rawJson = this.validationPipe.requireString(body, "rawJson");
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.updateAiRouting(appId, rawJson, desc);

    await this.auditInterceptor.record({
      appId,
      action: "admin.ai_routing.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: { adminUser },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetAiRoutingRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAiRoutingDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getAiRouting(appId, revision);

    await this.auditInterceptor.record({
      appId,
      action: "admin.ai_routing.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: { adminUser, revision },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreAiRoutingRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAiRoutingDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreAiRouting(appId, revision, desc);

    await this.auditInterceptor.record({
      appId,
      action: "admin.ai_routing.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: { adminUser, revision },
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetI18nSettings(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppI18nDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getI18nSettings(appId);

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

  private async handleAdminGetRemoteLogPullSettings(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getRemoteLogPullSettings(appId);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.read",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminUpdateRemoteLogPullSettings(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const desc = this.validationPipe.optionalString(body, "desc");
    const config = body.config ?? body;
    const result = await this.adminConsoleService.updateRemoteLogPullSettings(appId, config, desc);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.update",
      resourceType: "app_config",
      resourceId: result.configKey,
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetRemoteLogPullSettingsRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getRemoteLogPullSettings(appId, revision);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.revision.read",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: { adminUser, revision },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminRestoreRemoteLogPullSettingsRevision(
    request: HttpRequest,
    appId: string,
    revision: number,
  ): Promise<HttpResponse<AdminAppRemoteLogPullSettingsDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreRemoteLogPullSettings(appId, revision, desc);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.restore",
      resourceType: "app_config",
      resourceId: `${result.configKey}:${revision}`,
      payload: { adminUser, revision },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminListRemoteLogPullTasks(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.listRemoteLogPullTasks(appId);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.tasks.read",
      resourceType: "client_log_upload",
      resourceId: "task-list",
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminCreateRemoteLogPullTask(
    request: HttpRequest,
    appId: string,
  ): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.createRemoteLogPullTask(
      appId,
      this.validationPipe.asObject(request.body),
    );
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.task.create",
      resourceType: "client_log_upload",
      resourceId: result.items[0]?.taskId ?? "created",
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminCancelRemoteLogPullTask(
    request: HttpRequest,
    appId: string,
    taskId: string,
  ): Promise<HttpResponse<AdminAppRemoteLogPullTaskListDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.cancelRemoteLogPullTask(appId, taskId);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.task.cancel",
      resourceType: "client_log_upload",
      resourceId: taskId,
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetRemoteLogPullTaskFile(
    request: HttpRequest,
    appId: string,
    taskId: string,
  ): Promise<HttpResponse<AdminRemoteLogPullTaskFileDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getRemoteLogPullTaskFile(appId, taskId);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.task.file.read",
      resourceType: "client_log_upload",
      resourceId: taskId,
      payload: { adminUser },
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleAdminGetRemoteLogPullTask(
    request: HttpRequest,
    appId: string,
    taskId: string,
  ): Promise<HttpResponse<AdminRemoteLogPullTaskDocument>> {
    const adminUser = this.authenticateAdmin(request);
    const result = await this.adminConsoleService.getRemoteLogPullTask(appId, taskId);
    await this.auditInterceptor.record({
      appId,
      action: "admin.remote_log_pull.task.read",
      resourceType: "client_log_upload",
      resourceId: taskId,
      payload: { adminUser },
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

    await this.auditInterceptor.record({
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
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreI18nSettings(appId, revision, desc);

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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

    await this.auditInterceptor.record({
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
    const body = this.validationPipe.asObject(request.body ?? {});
    const desc = this.validationPipe.optionalString(body, "desc");
    const result = await this.adminConsoleService.restoreConfig(appId, revision, desc);

    await this.auditInterceptor.record({
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

    const result = await this.storageService.presignUpload({
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

    const result = await this.storageService.confirmUpload({
      appId: auth.appId,
      ownerUserId: auth.userId,
      storageKey: this.validationPipe.requireString(body, "storageKey"),
      mimeType: this.validationPipe.requireString(body, "mimeType"),
      sizeBytes: this.validationPipe.requireNumber(body, "sizeBytes"),
    });

    await this.auditInterceptor.record({
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
    await this.rbacGuard.assertPermission(auth.appId, auth.userId, "notification:send");

    const result = await this.notificationService.queueNotification({
      appId: auth.appId,
      recipientUserId: this.validationPipe.requireString(body, "recipientUserId"),
      channel: this.validationPipe.requireString(body, "channel") as "email" | "sms" | "push",
      payload: (body.payload as Record<string, unknown> | undefined) ?? {},
    });

    return this.ok(result, request.requestId as string);
  }

  private async handleAiNovelChatCompletions(request: HttpRequest): Promise<HttpResponse<unknown>> {
    await this.authenticateProductRequest(request, "ai_novel");
    const { keyId, plaintext } = await this.decryptAiRequestBody(request);

    try {
      const parsed = JSON.parse(plaintext.toString("utf8"));
      const body = this.validationPipe.asObject(parsed);
      const stream = body.stream === true;
      if (!stream && body.stream !== undefined && body.stream !== false) {
        throw new ApplicationError(400, "REQ_INVALID_BODY", "stream must be a boolean when provided.");
      }

      if (stream) {
        return this.encryptedAiStreamResponse(
          request,
          keyId,
          this.aiNovelLlmService.createChatCompletionStream(body),
        );
      }

      const result = await this.aiNovelLlmService.createChatCompletion(body);
      const localDebugResponseText = this.extractLocalAiDebugResponseText(result);
      return await this.encryptedAiResponse(
        request,
        keyId,
        {
          code: "OK",
          message: "success",
          data: result,
          requestId: request.requestId as string,
        },
        localDebugResponseText,
      );
    } catch (error) {
      const applicationError =
        error instanceof SyntaxError
          ? new ApplicationError(400, "REQ_INVALID_BODY", "Decrypted AI request body must be valid JSON.")
          : error;
      if (!isApplicationError(applicationError)) {
        throw error;
      }

      return await this.encryptedAiResponse(
        request,
        keyId,
        {
          code: applicationError.code,
          message: applicationError.message,
          data: null,
          requestId: request.requestId as string,
        },
      );
    }
  }

  private async handleAiNovelEmbeddings(request: HttpRequest): Promise<HttpResponse<unknown>> {
    return this.handleEncryptedAiRequest(request, async (body) => {
      return await this.aiNovelLlmService.createEmbeddings(body);
    });
  }

  private async handleEncryptedAiRequest(
    request: HttpRequest,
    handler: (body: Record<string, unknown>) => Promise<unknown>,
  ): Promise<HttpResponse<unknown>> {
    await this.authenticateProductRequest(request, "ai_novel");
    const { keyId, plaintext } = await this.decryptAiRequestBody(request);

    try {
      const parsed = JSON.parse(plaintext.toString("utf8"));
      const body = this.validationPipe.asObject(parsed);
      const result = await handler(body);
      const localDebugResponseText = this.extractLocalAiDebugResponseText(result);
      return await this.encryptedAiResponse(
        request,
        keyId,
        {
          code: "OK",
          message: "success",
          data: result,
          requestId: request.requestId as string,
        },
        localDebugResponseText,
      );
    } catch (error) {
      const applicationError =
        error instanceof SyntaxError
          ? new ApplicationError(400, "REQ_INVALID_BODY", "Decrypted AI request body must be valid JSON.")
          : error;
      if (!isApplicationError(applicationError)) {
        throw error;
      }

      return await this.encryptedAiResponse(
        request,
        keyId,
        {
          code: applicationError.code,
          message: applicationError.message,
          data: null,
          requestId: request.requestId as string,
        },
      );
    }
  }

  private async decryptAiRequestBody(
    request: HttpRequest,
  ): Promise<{ keyId: string; plaintext: Buffer }> {
    const envelope = this.validationPipe.asObject(request.body);
    let decrypted: { keyId: string; plaintext: Buffer };
    try {
      decrypted = await this.aiPayloadCryptoService.decryptJsonEnvelope(envelope);
    } catch (error) {
      this.mapAiCryptoError(error);
    }

    return decrypted;
  }

  private async encryptedAiResponse(
    request: HttpRequest,
    keyId: string,
    payload: {
      code: string;
      message: string;
      data: unknown;
      requestId: string;
    },
    localDebugResponseText?: string,
  ): Promise<HttpResponse<unknown>> {
    let encrypted: AesGcmJsonEnvelope;
    try {
      encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
        Buffer.from(JSON.stringify(payload), "utf8"),
        keyId,
      );
    } catch (error) {
      this.mapAiCryptoError(error);
    }

    return {
      statusCode: 200,
      body: {
        ...encrypted,
        ...(this.shouldExposeLocalAiDebugFields(request) && localDebugResponseText
            ? { localDebugResponseText }
            : {}),
      } as unknown as never,
    };
  }

  private encryptedAiStreamResponse(
    request: HttpRequest,
    keyId: string,
    stream: AsyncIterable<unknown>,
  ): HttpResponse<unknown> {
    const requestId = request.requestId as string;
    const shouldExposeLocalDebug = this.shouldExposeLocalAiDebugFields(request);

    const streamBody = this.createEncryptedAiSseStream(
      keyId,
      requestId,
      stream,
      shouldExposeLocalDebug,
    );

    return {
      statusCode: 200,
      contentType: "text/event-stream; charset=utf-8",
      headers: {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
      body: {
        code: "OK",
        message: "streaming",
        data: null,
        requestId,
      } as unknown as never,
      streamBody,
    };
  }

  private async *createEncryptedAiSseStream(
    keyId: string,
    requestId: string,
    stream: AsyncIterable<unknown>,
    shouldExposeLocalDebug: boolean,
  ): AsyncIterable<string> {
    try {
      for await (const item of stream) {
        const payload = {
          code: "OK",
          message: "success",
          data: item,
          requestId,
        };
        const encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
          Buffer.from(JSON.stringify(payload), "utf8"),
          keyId,
        );
        const localDebugResponseText = shouldExposeLocalDebug
          ? this.extractLocalAiDebugResponseText(
              item && typeof item === "object" && !Array.isArray(item)
                ? { completion: (item as Record<string, unknown>).completion }
                : undefined,
            )
          : undefined;
        const eventPayload = {
          ...encrypted,
          ...(localDebugResponseText ? { localDebugResponseText } : {}),
        };
        yield `data: ${JSON.stringify(eventPayload)}\n\n`;
      }
    } catch (error) {
      const applicationError = isApplicationError(error)
        ? error
        : new ApplicationError(500, "SYS_INTERNAL_ERROR", "An unexpected internal error occurred.");
      const encrypted = await this.aiPayloadCryptoService.encryptJsonEnvelope(
        Buffer.from(
          JSON.stringify({
            code: applicationError.code,
            message: applicationError.message,
            data: null,
            requestId,
          }),
          "utf8",
        ),
        keyId,
      );
      yield `data: ${JSON.stringify(encrypted)}\n\n`;
    }
  }

  private shouldExposeLocalAiDebugFields(request: HttpRequest): boolean {
    const host =
      getHeader(request.headers, "x-forwarded-host")
      ?? getHeader(request.headers, "host")
      ?? "";
    return /(?:^|:\/\/)(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(host)
      || /(?:127\.0\.0\.1|localhost)(?::\d+)?/i.test(host);
  }

  private extractLocalAiDebugResponseText(result: unknown): string | undefined {
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      return undefined;
    }

    const completion = (result as Record<string, unknown>).completion;
    if (!completion || typeof completion !== "object" || Array.isArray(completion)) {
      return undefined;
    }

    const content = (completion as Record<string, unknown>).content;
    if (typeof content !== "string") {
      return undefined;
    }

    const trimmed = content.trim();
    return trimmed ? trimmed : undefined;
  }
  private mapAiCryptoError(error: unknown): never {
    if (!(error instanceof AesGcmPayloadCryptoError)) {
      throw error;
    }

    switch (error.code) {
      case "UNSUPPORTED_ALGORITHM":
        throw new ApplicationError(400, "AI_UNSUPPORTED_ALGORITHM", "Unsupported AI encryption algorithm.");
      case "UNKNOWN_KEY":
        throw new ApplicationError(400, "AI_UNKNOWN_KEY_ID", "Unknown AI encryption key id.");
      case "INVALID_ENVELOPE":
        throw new ApplicationError(400, "REQ_INVALID_BODY", "Encrypted AI request envelope is invalid.");
      case "INVALID_NONCE":
      case "PAYLOAD_TOO_SMALL":
      case "DECRYPT_FAILED":
        throw new ApplicationError(400, "AI_DECRYPT_FAILED", "Unable to decrypt AI payload.");
      case "ENCRYPT_FAILED":
        throw new ApplicationError(500, "AI_ENCRYPT_FAILED", "Unable to encrypt AI response.");
    }
  }

  private async handleLogsPolicy(request: HttpRequest): Promise<HttpResponse<LogPolicyResult>> {
    const auth = await this.authenticate(request);
    const result = await this.clientLogUploadService.getPolicy(auth);
    return this.ok(result, request.requestId as string);
  }

  private async handleLogsPullTask(request: HttpRequest): Promise<HttpResponse<LogPullTaskResult>> {
    const auth = await this.authenticate(request);
    const result = await this.clientLogUploadService.getPullTask(auth, this.requireHeader(request, "x-did"));
    return this.ok(result, request.requestId as string);
  }

  private async handleLogsUpload(request: HttpRequest): Promise<HttpResponse<LogUploadResult>> {
    const auth = await this.authenticate(request);
    const result = await this.clientLogUploadService.upload({
      auth,
      did: this.requireHeader(request, "x-did"),
      taskId: this.requireHeader(request, "x-log-task-id"),
      claimToken: this.requireHeader(request, "x-log-claim-token"),
      keyId: this.requireHeader(request, "x-log-key-id"),
      encryption: this.requireHeader(request, "x-log-enc"),
      nonceBase64: this.requireHeader(request, "x-log-nonce"),
      contentEncoding: this.requireHeader(request, "x-log-content"),
      lineCountReported: this.optionalIntegerHeader(request, "x-log-line-count"),
      plainBytesReported: this.optionalIntegerHeader(request, "x-log-plain-bytes"),
      compressedBytesReported: this.optionalIntegerHeader(request, "x-log-compressed-bytes"),
      body: this.requireBinaryBody(request.body),
    });

    await this.auditInterceptor.record({
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

  private async handleLogsAckNoData(
    request: HttpRequest,
    taskId: string,
  ): Promise<HttpResponse<LogNoDataAckResult>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const status = this.validationPipe.requireString(body, "status");
    if (status !== "no_data") {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "status must be no_data.");
    }

    const result = await this.clientLogUploadService.acknowledgeNoData({
      auth,
      did: this.requireHeader(request, "x-did"),
      taskId,
      claimToken: this.validationPipe.requireString(body, "claimToken"),
    });
    return this.ok(result, request.requestId as string);
  }

  private async handleLogsFail(
    request: HttpRequest,
    taskId: string,
  ): Promise<HttpResponse<LogFailResult>> {
    const auth = await this.authenticate(request);
    const body = this.validationPipe.asObject(request.body);
    const result = await this.clientLogUploadService.fail({
      auth,
      did: this.requireHeader(request, "x-did"),
      taskId,
      claimToken: this.validationPipe.requireString(body, "claimToken"),
      reason: this.validationPipe.optionalString(body, "reason"),
      message: this.validationPipe.optionalString(body, "message"),
    });

    await this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "logs.fail",
      resourceType: "client_log_upload",
      resourceId: result.taskId,
      resourceOwnerUserId: auth.userId,
      payload: {
        failedAt: result.failedAt,
        failureReason: result.failureReason,
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
      await this.userService.getById(auth.userId);
      await this.appRegistryService.getAppOrThrow(auth.appId);
      await this.appRegistryService.ensureExistingMembership(auth.appId, auth.userId);
    }

    return auth;
  }

  private async authenticateProductRequest(request: HttpRequest, appId: string) {
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

  private async toAuthPayload(
    session: { userId: string; accessToken: string; refreshToken: string; expiresIn: number },
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
  const baseSeed = options.seed ?? buildDefaultSeed(passwordHasher);
  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : resolveRuntimeRedisUrl()
        ? await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() })
        : await KVManager.create({ backend: new InMemoryKVBackend() }));
  const shouldLoadManagedState = Boolean(options.database || options.databaseFactory);
  const managedStateStore = new ManagedStateStore(kvManager, {
    enabled: shouldLoadManagedState,
  });
  const seed = shouldLoadManagedState
    ? applyManagedState(baseSeed, await managedStateStore.load())
    : baseSeed;
  const database =
    options.database
    ?? (options.databaseFactory
      ? await options.databaseFactory(seed)
      : await PostgresDatabase.create(
          options.databaseUrl?.trim() || resolveRuntimeDatabaseUrl() || (() => {
            throw new Error("DATABASE_URL must be configured before starting PostgreSQL.");
          })(),
          seed,
          {
            migrationConnectionString:
              options.migrationDatabaseUrl?.trim() || resolveRuntimeMigrationDatabaseUrl(),
          },
        ));
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

  const appConfigService = new VersionedAppConfigService(database, cache, kvManager);
  const appI18nConfigService = new AppI18nConfigService(appConfigService);
  const appAiRoutingConfigService = new AppAiRoutingConfigService(appConfigService);
  const passwordManager = new PasswordManager(kvManager);
  const adminSessionStore = new AdminSessionStore(kvManager);
  const refreshTokenStore = new RefreshTokenStore(kvManager);
  const commonPasswordConfigService = new CommonPasswordConfigService(passwordManager);
  const secretReferenceResolver = new SecretReferenceResolver(commonPasswordConfigService);
  const commonEmailConfigService = new CommonEmailConfigService(appConfigService, commonPasswordConfigService, logger);
  const commonLlmConfigService = new CommonLlmConfigService(appConfigService, secretReferenceResolver);
  const appLogSecretService = new AppLogSecretService(database, kvManager);
  const logEncryptionKeyResolver = options.logEncryptionKeyResolver
    ?? new CompositeAesGcmEncryptionKeyResolver([
      new StaticAesGcmEncryptionKeyResolver(options.logEncryptionKeys),
      appLogSecretService,
    ]);
  const aiPayloadCryptoService = new AesGcmPayloadCryptoService(logEncryptionKeyResolver);
  const appRemoteLogPullService = new AppRemoteLogPullService(appConfigService, database, appLogSecretService);
  await database.withExclusiveSession(async () => {
    const initializedCommonLlmConfig = await commonLlmConfigService.initializeDefaultConfig();
    const initializedAppLogSecrets = await appLogSecretService.initializeSecrets(await database.listAppIds());
    const initializedRemoteLogPullConfigs = await appRemoteLogPullService.initializeMissingConfigs(
      await database.listAppIds(),
    );
    const initializedAiRoutingConfig = (await database.listAppIds()).includes(AI_NOVEL_APP_ID)
      ? await appAiRoutingConfigService.initializeAppConfig(AI_NOVEL_APP_ID)
      : false;
    if (initializedCommonLlmConfig || initializedAppLogSecrets || initializedRemoteLogPullConfigs || initializedAiRoutingConfig) {
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
  const tencentCloudCommonCredentials = await resolveTencentCloudCommonCredentials(commonPasswordConfigService);
  const registrationEmailSender =
    options.registrationEmailSender ??
    (options.serviceName === "api"
      ? new TencentSesRegistrationEmailSender(commonEmailConfigService)
      : new NoopRegistrationEmailSender());
  const smsVerificationSender =
    options.smsVerificationSender ??
    (options.serviceName === "api"
      ? new TencentSmsVerificationSender(resolveTencentSmsVerificationConfig(options, tencentCloudCommonCredentials))
      : new NoopSmsVerificationSender());
  const captchaVerificationService =
    options.captchaVerificationService ??
    (options.serviceName === "api"
      ? new TencentCaptchaVerificationService(resolveTencentCaptchaVerificationConfig(options, tencentCloudCommonCredentials))
      : new NoopCaptchaVerificationService());
  const emailTestSendService = new EmailTestSendService(
    commonEmailConfigService,
    kvManager,
    registrationEmailSender,
  );
  const adminSensitiveOperationService = new AdminSensitiveOperationService(
    kvManager,
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
    smsVerificationSender,
    options.registrationCodeGenerator,
    resolveSecureRefreshCookie(options),
    resolveRefreshCookieSameSite(options),
  );
  const qrLoginService = new QrLoginService(cache, appRegistryService, userService, authService);
  const analyticsService = new AnalyticsService(database, appRegistryService);
  const bailianProvider = new BailianOpenAICompatibleProvider();
  const llmProviders = options.llmProviders ?? {
    bailian: bailianProvider,
    bailian_coding: bailianProvider,
  };
  const embeddingProviders = options.embeddingProviders ?? {
    bailian: bailianProvider,
    bailian_coding: bailianProvider,
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
  const adminConsoleService = new AdminConsoleService(
    database,
    appConfigService,
    appI18nConfigService,
    appAiRoutingConfigService,
    appRemoteLogPullService,
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
  const aiNovelLlmService = new AiNovelLlmService(llmManager, embeddingManager, appAiRoutingConfigService);
  const storageService = new StorageService(database);
  const persistentFileStore = new PersistentFileStore(options.fileStorageRoot);
  const clientLogUploadService = new ClientLogUploadService(database, logEncryptionKeyResolver, appRemoteLogPullService, {
    fileStore: persistentFileStore,
  });
  const notificationService = new NotificationService(database, queue, logger);
  const failedEventRetryService = new FailedEventRetryService(database, queue, logger);
  const apps = await database.listApps();
  const appContextResolver = new AppContextResolver(
    new Map(
      apps
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
    appAiRoutingConfigService,
    adminBasicAuth,
    adminSessionStore,
    appLogSecretService,
    adminSensitiveOperationService,
    llmManager,
    embeddingManager,
    llmSmokeTestService,
    aiNovelLlmService,
    aiPayloadCryptoService,
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
      appRemoteLogPullService,
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
      appAiRoutingConfigService,
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
      smsVerificationSender,
      captchaVerificationService,
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

async function resolveTencentCloudCommonCredentials(
  commonPasswordConfigService: CommonPasswordConfigService,
): Promise<{ secretId?: string; secretKey?: string }> {
  const [secretId, secretKey] = await Promise.all([
    commonPasswordConfigService.getValue(TENCENT_SECRET_ID_PASSWORD_KEY),
    commonPasswordConfigService.getValue(TENCENT_SECRET_KEY_PASSWORD_KEY),
  ]);

  return {
    secretId,
    secretKey,
  };
}

function resolveTencentSmsVerificationConfig(
  options: CreateApplicationOptions,
  credentials?: { secretId?: string; secretKey?: string },
): TencentSmsVerificationConfig {
  return {
    secretId: options.tencentSmsVerificationConfig?.secretId
      ?? credentials?.secretId
      ?? process.env.TENCENT_SMS_SECRET_ID
      ?? process.env.TZ_SECRET_ID,
    secretKey: options.tencentSmsVerificationConfig?.secretKey
      ?? credentials?.secretKey
      ?? process.env.TENCENT_SMS_SECRET_KEY
      ?? process.env.TZ_SECRET_KEY,
    sdkAppId: options.tencentSmsVerificationConfig?.sdkAppId
      ?? process.env.TENCENT_SMS_SDK_APP_ID,
    templateId: options.tencentSmsVerificationConfig?.templateId
      ?? process.env.TENCENT_SMS_TEMPLATE_ID,
    signName: options.tencentSmsVerificationConfig?.signName
      ?? process.env.TENCENT_SMS_SIGN_NAME,
    region: options.tencentSmsVerificationConfig?.region
      ?? process.env.TENCENT_SMS_REGION
      ?? "ap-beijing",
  };
}

function resolveTencentCaptchaVerificationConfig(
  options: CreateApplicationOptions,
  credentials?: { secretId?: string; secretKey?: string },
): TencentCaptchaVerificationConfig {
  const rawCaptchaAppId = options.tencentCaptchaVerificationConfig?.captchaAppId
    ?? Number(process.env.TENCENT_CAPTCHA_APP_ID ?? "0");
  return {
    secretId: options.tencentCaptchaVerificationConfig?.secretId
      ?? credentials?.secretId
      ?? process.env.TENCENT_CAPTCHA_SECRET_ID
      ?? process.env.TENCENT_SMS_SECRET_ID
      ?? process.env.TZ_SECRET_ID,
    secretKey: options.tencentCaptchaVerificationConfig?.secretKey
      ?? credentials?.secretKey
      ?? process.env.TENCENT_CAPTCHA_SECRET_KEY
      ?? process.env.TENCENT_SMS_SECRET_KEY
      ?? process.env.TZ_SECRET_KEY,
    captchaAppId: Number.isInteger(rawCaptchaAppId) && rawCaptchaAppId > 0 ? rawCaptchaAppId : undefined,
    appSecretKey: options.tencentCaptchaVerificationConfig?.appSecretKey
      ?? process.env.TENCENT_CAPTCHA_APP_SECRET_KEY
      ?? process.env.TZ_CAP_SECRET_KEY,
  };
}
