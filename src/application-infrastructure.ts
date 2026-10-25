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
import { PersistentFileStore } from "./infrastructure/files/persistent-file-store.ts";
import { StorageService } from "./infrastructure/files/storage.service.ts";
import { InMemoryKVBackend, KVManager } from "./infrastructure/kv/kv-manager.ts";
import { ManagedStateStore, applyManagedState } from "./infrastructure/kv/managed-state.store.ts";
import { StructuredLogger } from "./infrastructure/logging/pino-logger.module.ts";
import { createLocalRunFileLogSink } from "./infrastructure/logging/local-run-file-log-sink.ts";
import { InMemoryJobQueue } from "./infrastructure/queue/bullmq/in-memory-queue.ts";
import { RedisJobQueue } from "./infrastructure/queue/bullmq/redis-queue.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import { resolveRuntimeDatabaseUrl, resolveRuntimeMigrationDatabaseUrl, resolveRuntimeRedisUrl } from "./infrastructure/runtime/runtime-readiness.ts";
import { AdminConsoleService } from "./modules/admin/admin-console.service.ts";
import { AdminAiNovelModelHealthService } from "./modules/admin/admin-ai-novel-model-health.service.ts";
import { AiNovelDebugTraceService } from "./modules/ai-novel/ai-novel-debug-trace.service.ts";
import { AiNovelLlmService } from "./modules/ai-novel/ai-novel-llm.service.ts";
import { AiNovelConversationRecordService } from "./modules/ai-novel/ai-novel-conversation-record.service.ts";
import { AiNovelSkillRepository } from "./modules/ai-novel/ai-novel-skill-repository.ts";
import { AiNovelSkillService } from "./modules/ai-novel/ai-novel-skill.service.ts";
import { AiNovelModelSelectionConfigService } from "./modules/ai-novel/ai-novel-model-selection-config.service.ts";
import { AnalyticsService } from "./modules/analytics/analytics.service.ts";
import { AppRegistryService } from "./modules/app-registry/app-registry.service.ts";
import { AuthService } from "./modules/auth/auth.service.ts";
import { DevelopmentPasswordHasher } from "./modules/auth/password-hasher.ts";
import { QrLoginService } from "./modules/auth/qr-login.service.ts";
import { TokenService } from "./modules/auth/token.service.ts";
import { RbacService } from "./modules/iam/rbac.service.ts";
import { UserService } from "./modules/user/user.service.ts";
import { createBodyLogServices } from "./application-bodylog-services.ts";
import { AdminSensitiveOperationService } from "./services/admin-sensitive-operation.service.ts";
import { AiOutputReportingService } from "./services/ai-output-reporting.service.ts";
import { AesGcmPayloadCryptoService, CompositeAesGcmEncryptionKeyResolver, StaticAesGcmEncryptionKeyResolver } from "./services/aes-gcm-payload-crypto.service.ts";
import { AppAiRoutingConfigService } from "./services/app-ai-routing-config.service.ts";
import { AppI18nConfigService } from "./services/app-i18n-config.service.ts";
import { AppLogSecretService } from "./services/app-log-secret.service.ts";
import { AppRemoteLogPullService } from "./services/app-remote-log-pull.service.ts";
import { ClientLogUploadService } from "./services/client-log-upload.service.ts";
import { CommonAuthRateLimitConfigService } from "./services/common-auth-rate-limit-config.service.ts";
import { CommonContentSafetyConfigService } from "./services/common-content-safety-config.service.ts";
import { CommonEmailConfigService } from "./services/common-email-config.service.ts";
import { CommonGetuiGyConfigService } from "./services/common-getui-gy-config.service.ts";
import { CommonLlmConfigService } from "./services/common-llm-config.service.ts";
import { CommonPasswordConfigService } from "./services/common-password-config.service.ts";
import { CommonReleaseUpdateConfigService } from "./services/common-release-update-config.service.ts";
import { CommonSmsConfigService } from "./services/common-sms-config.service.ts";
import { CommonTestAccountService } from "./services/common-test-account.service.ts";
import { JevContentSafetyClient } from "./services/jev-content-safety-client.ts";
import { createOpenRouterTransparentProxyFetch } from "./services/openrouter-transparent-proxy.ts";
import { ContentSafetyCounters } from "./services/content-safety-counters.ts";
import { ContentSafetyService } from "./services/content-safety.service.ts";
import { EmailTestSendService } from "./services/email-test-send.service.ts";
import { FeedbackService } from "./services/feedback.service.ts";
import { GetuiGyOneClickLoginService } from "./services/getui-gy-one-click-login.service.ts";
import { I18nService } from "./services/i18n.service.ts";
import { LlmHealthService } from "./services/llm-health.service.ts";
import { LlmMetricsService } from "./services/llm-metrics.service.ts";
import { LlmModelHealthService } from "./services/llm-model-health.service.ts";
import { LlmObservabilityRetentionService } from "./services/llm-observability-retention.service.ts";
import { LlmEmailAlertService } from "./services/llm-email-alert.service.ts";
import { LlmRouteCircuitBreakerService } from "./services/llm-route-circuit-breaker.service.ts";
import { NotificationService } from "./services/notification.service.ts";
import { AdminSessionStore } from "./services/admin-session-store.ts";
import { PasswordManager } from "./services/password-manager.ts";
import { PublicApiMessageService } from "./services/public-api-message.service.ts";
import { RefreshTokenStore } from "./services/refresh-token-store.ts";
import { HttpGeoResolver, NoopGeoResolver, RequestEmailContextService } from "./services/request-email-context.service.ts";
import { RequestLocaleService } from "./services/request-locale.service.ts";
import { SecretReferenceResolver } from "./services/secret-reference-resolver.ts";
import { SmsVerificationCleanupService } from "./services/sms-verification-cleanup.service.ts";
import { SmsVerificationRecordService } from "./services/sms-verification-record.service.ts";
import { NoopCaptchaVerificationService, TencentCaptchaVerificationService } from "./services/tencent-captcha-verification.service.ts";
import { TencentSesEmailCallbackService } from "./services/tencent-ses-email-callback.service.ts";
import { NoopRegistrationEmailSender, TencentSesRegistrationEmailSender } from "./services/tencent-ses-registration-email.service.ts";
import { NoopSmsVerificationSender, TencentSmsVerificationSender } from "./services/tencent-sms-verification.service.ts";
import { VersionedAppConfigService } from "./services/versioned-app-config.service.ts";
import { BackendApplication } from "./app/backend-application.ts";
import { createApplicationAiRuntime } from "./application-ai-runtime.ts";
import { resolveRuntimeLlmProviderKeys } from "./application-llm-provider-keys.ts";
import { initializeApplicationConfigs } from "./application-startup-config.ts";
import { createApplicationTelemetryGateway } from "./application-telemetry-runtime.ts";
import { resolveAccessTokenSecrets, resolveAdminBasicAuth, resolveRefreshCookieSameSite, resolveSecureRefreshCookie } from "./application-auth-runtime-config.ts";
import { resolveFrogSleepEnabled } from "./application-frogsleep-runtime-config.ts";
import { resolveLightTickEnabled, resolveLightTickSeedEnabled } from "./application-lighttick-runtime-config.ts";
import { attachApplicationLightTickAccount, attachApplicationLightTickAnalytics, attachApplicationLightTickWorkers, createApplicationLightTickRuntime, resolveApplicationLightTickRepository } from "./application-lighttick-services.ts";
import { createFrogSleepWorkerServices } from "./application-frogsleep-worker-services.ts";
import type { CreateApplicationOptions } from "./application-options.ts";
import { resolvePublicSmsTestBypass } from "./application-public-sms-runtime-config.ts";
import { resolveTencentCaptchaVerificationConfig, resolveTencentCloudCommonCredentials, resolveTencentSmsVerificationConfig } from "./tencent-cloud-runtime-config.ts";
export async function createApplicationInfrastructure(options:CreateApplicationOptions) {
  const passwordHasher = new DevelopmentPasswordHasher();
  const frogsleepEnabled = resolveFrogSleepEnabled(options); const lighttickEnabled = resolveLightTickEnabled(options);
  const lighttickSeedEnabled = resolveLightTickSeedEnabled(options, lighttickEnabled);
  const baseSeed = options.seed ?? buildDefaultSeed(passwordHasher, { includeFrogSleep: frogsleepEnabled, includeLightTick: lighttickSeedEnabled });
  const kvManager =
    options.kvManager ??
    (options.kvBackend
      ? await KVManager.create({ backend: options.kvBackend })
      : resolveRuntimeRedisUrl()
        ? await KVManager.getShared({ redisUrl: resolveRuntimeRedisUrl() })
        : await KVManager.create({ backend: new InMemoryKVBackend() }));
  const shouldLoadManagedState = Boolean(
    options.database || options.databaseFactory,
  );
  const managedStateStore = new ManagedStateStore(kvManager, {
    enabled: shouldLoadManagedState,
  });
  const seed = shouldLoadManagedState
    ? applyManagedState(baseSeed, await managedStateStore.load())
    : baseSeed;
  const database =
    options.database ??
    (options.databaseFactory
      ? await options.databaseFactory(seed)
      : await PostgresDatabase.create(
          options.databaseUrl?.trim() ||
            resolveRuntimeDatabaseUrl() ||
            (() => {
              throw new Error(
                "DATABASE_URL must be configured before starting PostgreSQL.",
              );
            })(),
          seed,
          {
            migrationConnectionString:
              options.migrationDatabaseUrl?.trim() ||
              resolveRuntimeMigrationDatabaseUrl(),
          },
        ));
  const lighttickRepository = resolveApplicationLightTickRepository(database, options.lighttickRepository);
  const cache = new InMemoryCache();
  const defaultQueueBackend =
    options.queueRedisUrl?.trim() || resolveRuntimeRedisUrl()
      ? "redis"
      : "memory";
  const resolvedQueueBackend = options.queueBackend ?? defaultQueueBackend;
  const queue =
    options.queue ??
    (resolvedQueueBackend === "redis"
      ? new RedisJobQueue(
          options.queueRedisUrl?.trim() ||
            resolveRuntimeRedisUrl() ||
            (() => {
              throw new Error(
                "REDIS_URL must be configured before starting the Redis job queue backend.",
              );
            })(),
        )
      : new InMemoryJobQueue());
  return {passwordHasher,frogsleepEnabled,lighttickEnabled,kvManager,managedStateStore,database,lighttickRepository,cache,queue};
}
