import { AppContextResolver } from "../core/context/app-context.resolver.ts";
import { HttpExceptionFilter } from "../core/filters/http-exception.filter.ts";
import { AppAccessGuard } from "../core/guards/app-access.guard.ts";
import { AuthGuard } from "../core/guards/auth.guard.ts";
import { RbacGuard } from "../core/guards/rbac.guard.ts";
import { AuditInterceptor } from "../core/interceptors/audit.interceptor.ts";
import { RequestLoggingInterceptor } from "../core/interceptors/request-logging.interceptor.ts";
import { ValidationPipe } from "../core/pipes/validation.pipe.ts";
import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AdminConsoleService } from "../modules/admin/admin-console.service.ts";
import { AiNovelAuditFileService } from "../modules/ai-novel/ai-novel-audit-file.service.ts";
import { AiNovelLlmService } from "../modules/ai-novel/ai-novel-llm.service.ts";
import { AppRegistryService } from "../modules/app-registry/app-registry.service.ts";
import { AuthService } from "../modules/auth/auth.service.ts";
import { QrLoginService } from "../modules/auth/qr-login.service.ts";
import { UserService } from "../modules/user/user.service.ts";
import { AnalyticsService } from "../modules/analytics/analytics.service.ts";
import { AppAiRoutingConfigService } from "../services/app-ai-routing-config.service.ts";
import { AppLogSecretService } from "../services/app-log-secret.service.ts";
import { AppRemoteLogPullService } from "../services/app-remote-log-pull.service.ts";
import { AdminSensitiveOperationService } from "../services/admin-sensitive-operation.service.ts";
import { AesGcmPayloadCryptoService } from "../services/aes-gcm-payload-crypto.service.ts";
import { ClientLogUploadService } from "../services/client-log-upload.service.ts";
import { ContentSafetyService } from "../services/content-safety.service.ts";
import { EmbeddingManager } from "../services/embedding-manager.ts";
import { FailedEventRetryService } from "../services/failed-event-retry.service.ts";
import { GetuiGyOneClickLoginService } from "../services/getui-gy-one-click-login.service.ts";
import { LlmSmokeTestService } from "../services/llm-smoke-test.service.ts";
import { LLMManager } from "../services/llm-manager.ts";
import { NotificationService } from "../services/notification.service.ts";
import { AdminSessionStore } from "../services/admin-session-store.ts";
import type { CommonGetuiGyConfigService } from "../services/common-getui-gy-config.service.ts";
import { PublicApiMessageService } from "../services/public-api-message.service.ts";
import { RequestEmailContextService } from "../services/request-email-context.service.ts";
import { RequestLocaleService } from "../services/request-locale.service.ts";
import { StorageService } from "../infrastructure/files/storage.service.ts";
import { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { parseCookies, randomId } from "../shared/utils.ts";
import { BackendRouteContext, type ResolvedAdminBasicAuth } from "./backend-route-context.ts";
import { tryHandleAdminRoutes } from "./admin-routes.ts";
import { tryHandleAiNovelRoutes } from "./ai-novel-routes.ts";
import { tryHandleFileNotificationRoutes } from "./file-notification-routes.ts";
import { tryHandleLogRoutes } from "./log-routes.ts";
import { tryHandlePublicAuthRoutes } from "./public-auth-routes.ts";

const DEFAULT_RUNTIME_VERSION = "0.1.0";

function resolveRuntimeVersion(rawVersion = process.env.APP_VERSION): string {
  const normalized = rawVersion?.trim();
  return normalized || DEFAULT_RUNTIME_VERSION;
}

/**
 * BackendApplication wires the documented modules into a minimal executable runtime.
 */
export class BackendApplication extends BackendRouteContext {
  constructor(
    private readonly database: ApplicationDatabase,
    private readonly authService: AuthService,
    private readonly getuiGyOneClickLoginService: GetuiGyOneClickLoginService,
    private readonly commonGetuiGyConfigService: CommonGetuiGyConfigService,
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
    private readonly contentSafetyService: ContentSafetyService,
    private readonly llmSmokeTestService: LlmSmokeTestService,
    private readonly aiNovelAuditFileService: AiNovelAuditFileService,
    private readonly aiNovelLlmService: AiNovelLlmService,
    private readonly aiPayloadCryptoService: AesGcmPayloadCryptoService,
    private readonly storageService: StorageService,
    private readonly clientLogUploadService: ClientLogUploadService,
    private readonly notificationService: NotificationService,
    private readonly failedEventRetryService: FailedEventRetryService,
    private readonly requestEmailContextService: RequestEmailContextService,
    private readonly requestLocaleService: RequestLocaleService,
    private readonly publicApiMessageService: PublicApiMessageService,
    private readonly logger: StructuredLogger,
    private readonly auditInterceptor: AuditInterceptor,
    private readonly requestLoggingInterceptor: RequestLoggingInterceptor,
    private readonly httpExceptionFilter: HttpExceptionFilter,
    private readonly appContextResolver: AppContextResolver,
    private readonly authGuard: AuthGuard,
    private readonly appAccessGuard: AppAccessGuard,
    private readonly rbacGuard: RbacGuard,
    private readonly validationPipe: ValidationPipe,
  ) {
    super(
      database,
      authService,
      userService,
      appRegistryService,
      adminBasicAuth,
      adminSessionStore,
      publicApiMessageService,
      appContextResolver,
      authGuard,
      appAccessGuard,
      validationPipe,
    );
  }

  async handle(request: HttpRequest): Promise<HttpResponse<unknown>> {
    request.requestId ??= randomId("req");
    request.cookies ??= parseCookies(request.headers.cookie);
    const execute = async () => {
      request.adminSession = await this.resolveAdminSession(request);
      const startedAt = Date.now();

      try {
        const response = await this.dispatch(request);
        this.requestLoggingInterceptor.log(
          request,
          response,
          Date.now() - startedAt,
        );
        return response;
      } catch (error) {
        const response = this.httpExceptionFilter.catch(
          error,
          request,
          request.requestId,
        );
        this.requestLoggingInterceptor.log(
          request,
          response,
          Date.now() - startedAt,
          error,
        );
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
      getuiGyOneClickLoginService: this.getuiGyOneClickLoginService,
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
      aiNovelAuditFileService: this.aiNovelAuditFileService,
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
      return this.ok(
        { status: "ok", version: resolveRuntimeVersion() },
        request.requestId as string,
      );
    }

    const adminResponse = await tryHandleAdminRoutes.call(this, request);
    if (adminResponse) {
      return adminResponse;
    }

    const publicAuthResponse = await tryHandlePublicAuthRoutes.call(this, request);
    if (publicAuthResponse) {
      return publicAuthResponse;
    }

    const fileNotificationResponse = await tryHandleFileNotificationRoutes.call(this, request);
    if (fileNotificationResponse) {
      return fileNotificationResponse;
    }

    const aiNovelResponse = await tryHandleAiNovelRoutes.call(this, request);
    if (aiNovelResponse) {
      return aiNovelResponse;
    }

    const logResponse = await tryHandleLogRoutes.call(this, request);
    if (logResponse) {
      return logResponse;
    }

    throw new ApplicationError(404, "REQ_INVALID_BODY", "Route not found.");
  }





}
