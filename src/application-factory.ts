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
import { AiNovelAuditFileService } from "./modules/ai-novel/ai-novel-audit-file.service.ts";
import { AiNovelLlmService } from "./modules/ai-novel/ai-novel-llm.service.ts";
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
import { BodyLogProfileService } from "./modules/bodylog/bodylog-profile.service.ts";
import { BodyLogSocialService } from "./modules/bodylog/bodylog-social.service.ts";
import { BodyLogLeaderboardService } from "./modules/bodylog/bodylog-leaderboard.service.ts";
import { BodyLogInvitationService } from "./modules/bodylog/bodylog-invitation.service.ts";
import { BodyLogChallengeService } from "./modules/bodylog/bodylog-challenge.service.ts";
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
import { CommonSmsConfigService } from "./services/common-sms-config.service.ts";
import { CommonTestAccountService } from "./services/common-test-account.service.ts";
import { ContentSafetyService } from "./services/content-safety.service.ts";
import { EmailTestSendService } from "./services/email-test-send.service.ts";
import { FeedbackService } from "./services/feedback.service.ts";
import { GetuiGyOneClickLoginService } from "./services/getui-gy-one-click-login.service.ts";
import { I18nService } from "./services/i18n.service.ts";
import { LlmHealthService } from "./services/llm-health.service.ts";
import { LlmMetricsService } from "./services/llm-metrics.service.ts";
import { LlmModelHealthService } from "./services/llm-model-health.service.ts";
import { LlmObservabilityRetentionService } from "./services/llm-observability-retention.service.ts";
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
export async function createApplication(options: CreateApplicationOptions = {}) {
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
  const lighttickRuntime = createApplicationLightTickRuntime(lighttickRepository, queue);
  const localRunFileLogSink = createLocalRunFileLogSink({
    service: options.serviceName ?? "api",
  });
  const logger = new StructuredLogger(options.serviceName ?? "api", {
    emitToConsole: options.emitLogs ?? false,
    sinks: localRunFileLogSink ? [localRunFileLogSink.sink] : [],
  });
  const telemetryGateway = createApplicationTelemetryGateway(options, logger);
  if (localRunFileLogSink) {
    logger.info("local run file logging enabled", {
      runId: localRunFileLogSink.runId,
      logDirectory: localRunFileLogSink.directory,
      logFile: localRunFileLogSink.currentPath,
    });
  }
  const appConfigService = new VersionedAppConfigService(
    database,
    cache,
    kvManager,
  );
  const appI18nConfigService = new AppI18nConfigService(appConfigService);
  const appAiRoutingConfigService = new AppAiRoutingConfigService(appConfigService);
  const passwordManager = new PasswordManager(kvManager);
  const adminSessionStore = new AdminSessionStore(kvManager);
  const refreshTokenStore = new RefreshTokenStore(kvManager);
  const smsVerificationRecordService = new SmsVerificationRecordService(
    database,
  );
  const smsVerificationCleanupService = new SmsVerificationCleanupService(
    database,
    kvManager,
  );
  const commonPasswordConfigService = new CommonPasswordConfigService(
    passwordManager,
  );
  const tencentSesEmailCallbackService = new TencentSesEmailCallbackService(
    database,
    commonPasswordConfigService,
  );
  const secretReferenceResolver = new SecretReferenceResolver(
    commonPasswordConfigService,
  );
  const commonEmailConfigService = new CommonEmailConfigService(
    appConfigService,
    commonPasswordConfigService,
    logger,
  );
  const commonSmsConfigService = new CommonSmsConfigService(
    appConfigService,
    commonPasswordConfigService,
    logger,
  );
  const commonAuthRateLimitConfigService = new CommonAuthRateLimitConfigService(
    appConfigService,
  );
  const commonTestAccountService = new CommonTestAccountService(
    database,
    kvManager,
    appConfigService,
    options.registrationCodeGenerator,
    async () => await managedStateStore.save(database),
  );
  const commonGetuiGyConfigService = new CommonGetuiGyConfigService(
    appConfigService,
  );
  const commonLlmConfigService = new CommonLlmConfigService(
    appConfigService,
    secretReferenceResolver,
  );
  const commonContentSafetyConfigService = new CommonContentSafetyConfigService(
    appConfigService,
  );
  const appLogSecretService = new AppLogSecretService(database, kvManager);
  const logEncryptionKeyResolver =
    options.logEncryptionKeyResolver ??
    new CompositeAesGcmEncryptionKeyResolver([
      new StaticAesGcmEncryptionKeyResolver(options.logEncryptionKeys),
      appLogSecretService,
    ]);
  const aiPayloadCryptoService = new AesGcmPayloadCryptoService(
    logEncryptionKeyResolver,
  );
  const appRemoteLogPullService = new AppRemoteLogPullService(
    appConfigService,
    database,
    appLogSecretService,
  );
  await initializeApplicationConfigs({
    database,
    managedStateStore,
    appConfigService,
    appLogSecretService,
    appRemoteLogPullService,
    commonGetuiGyConfigService,
    commonLlmConfigService,
    commonPasswordConfigService,
  });
  const runtimeLlmProviderKeys = resolveRuntimeLlmProviderKeys(options);
  const llmHealthService = new LlmHealthService(database.llmObservabilityStore, runtimeLlmProviderKeys);
  const llmMetricsService = new LlmMetricsService(database.llmObservabilityStore, llmHealthService, logger);
  const llmModelHealthService = new LlmModelHealthService(commonLlmConfigService, llmHealthService);
  const aiNovelModelSelectionConfigService = new AiNovelModelSelectionConfigService(
    appConfigService,
    commonLlmConfigService,
    llmModelHealthService,
    logger,
  );
  const llmObservabilityRetentionService = new LlmObservabilityRetentionService(database.llmObservabilityStore, kvManager);
  const appRegistryService = new AppRegistryService(database, appConfigService);
  const userService = new UserService(database);
  const accessTokenSecrets = resolveAccessTokenSecrets(options);
  const tokenService = new TokenService(accessTokenSecrets.current, {
    previousSecrets: accessTokenSecrets.previous,
  });
  const tencentCloudCommonCredentials =
    await resolveTencentCloudCommonCredentials(commonPasswordConfigService);
  const baseTencentSmsVerificationConfig = resolveTencentSmsVerificationConfig(
    options,
    tencentCloudCommonCredentials,
  );
  const registrationEmailSender =
    options.registrationEmailSender ??
    (options.serviceName === "api" || options.serviceName === "worker"
      ? new TencentSesRegistrationEmailSender(commonEmailConfigService)
      : new NoopRegistrationEmailSender());
  const smsVerificationSender =
    options.smsVerificationSender ??
    (options.serviceName === "api"
      ? ({
          async sendVerificationCode(command) {
            const config = await commonSmsConfigService.getRuntimeConfig(
              baseTencentSmsVerificationConfig,
            );
            return new TencentSmsVerificationSender(
              config,
            ).sendVerificationCode(command);
          },
        } satisfies SmsVerificationSender)
      : new NoopSmsVerificationSender());
  const captchaVerificationService =
    options.captchaVerificationService ??
    (options.serviceName === "api"
      ? new TencentCaptchaVerificationService(
          resolveTencentCaptchaVerificationConfig(
            options,
            tencentCloudCommonCredentials,
          ),
        )
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
  const requestEmailContextService = new RequestEmailContextService(
    geoResolver,
  );
  const requestLocaleService = new RequestLocaleService();
  const publicApiMessageService = new PublicApiMessageService(
    requestLocaleService,
  );
  const i18nService = new I18nService(
    appI18nConfigService,
    requestLocaleService,
  );
  const authService = new AuthService(
    database,
    kvManager,
    userService,
    appRegistryService,
    passwordHasher,
    tokenService,
    refreshTokenStore,
    commonAuthRateLimitConfigService,
    registrationEmailSender,
    smsVerificationSender,
    smsVerificationRecordService,
    commonTestAccountService,
    options.registrationCodeGenerator,
    resolveSecureRefreshCookie(options),
    resolveRefreshCookieSameSite(options),
    resolvePublicSmsTestBypass(options),
  ); attachApplicationLightTickAccount({ runtime: lighttickRuntime, database, kv: kvManager, appRegistry: appRegistryService, auth: authService, repository: lighttickRepository });
  const qrLoginService = new QrLoginService(
    cache,
    appRegistryService,
    userService,
    authService,
  );
  const getuiGyOneClickLoginService = new GetuiGyOneClickLoginService(
    commonGetuiGyConfigService,
  );
  const analyticsService = new AnalyticsService(database, appRegistryService); attachApplicationLightTickAnalytics(lighttickRuntime, analyticsService);
  const {
    aiNovelStatisticsService,
    embeddingManager,
    llmManager,
    llmSmokeTestService,
  } = createApplicationAiRuntime({
    database,
    commonLlmConfigService,
    commonPasswordConfigService,
    llmHealthService,
    llmMetricsService,
    kvManager,
    logger,
    llmProviders: options.llmProviders,
    embeddingProviders: options.embeddingProviders,
  });
  const aiNovelAuditFileService = new AiNovelAuditFileService(
    options.aiNovelAuditFileRoot,
  );
  const aiNovelSkillService = new AiNovelSkillService(
    new AiNovelSkillRepository(options.aiNovelSkillRoot),
  );
  const adminConsoleService = new AdminConsoleService(
    database,
    appConfigService,
    appI18nConfigService,
    appAiRoutingConfigService,
    aiNovelModelSelectionConfigService,
    appRemoteLogPullService,
    appLogSecretService,
    commonEmailConfigService,
    commonSmsConfigService,
    commonAuthRateLimitConfigService,
    commonGetuiGyConfigService,
    commonLlmConfigService,
    commonContentSafetyConfigService,
    commonPasswordConfigService,
    emailTestSendService,
    llmHealthService,
    llmMetricsService,
    new AdminAiNovelModelHealthService(llmMetricsService, llmModelHealthService),
    llmSmokeTestService,
    refreshTokenStore,
    smsVerificationRecordService,
    managedStateStore,
  );
  const rbacService = new RbacService(database);
  const contentSafetyService = new ContentSafetyService(
    commonContentSafetyConfigService,
    llmManager,
    commonPasswordConfigService,
    database,
    logger,
  );
  const bodyLogProfileService = new BodyLogProfileService(database, contentSafetyService);
  const bodyLogSocialService = new BodyLogSocialService(database, bodyLogProfileService);
  const bodyLogLeaderboardService = new BodyLogLeaderboardService(database, bodyLogProfileService);
  const bodyLogInvitationService = new BodyLogInvitationService(database);
  const bodyLogChallengeService = new BodyLogChallengeService(database, bodyLogProfileService);
  const aiNovelLlmService = new AiNovelLlmService(
    llmManager,
    embeddingManager,
    aiNovelModelSelectionConfigService,
    logger,
    contentSafetyService,
  );
  const storageService = new StorageService(database);
  const persistentFileStore = new PersistentFileStore(options.fileStorageRoot);
  const feedbackService = new FeedbackService(database, persistentFileStore);
  const aiOutputReportingService = new AiOutputReportingService(database, aiPayloadCryptoService, appLogSecretService);
  const clientLogUploadService = new ClientLogUploadService(
    database,
    logEncryptionKeyResolver,
    appRemoteLogPullService,
    {
      fileStore: persistentFileStore,
    },
  );
  const {
    notificationService,
    buddyNotificationWorkerService,
    buddyInvitationEmailWorkerService,
    buddyMilestoneReportService,
    failedEventRetryService,
  } = createFrogSleepWorkerServices({
    database,
    queue,
    logger,
    commonEmailConfigService,
    registrationEmailSender,
  });
  attachApplicationLightTickWorkers({ runtime: lighttickRuntime, repository: lighttickRepository, queue, llmManager, notificationService, database, appAiRoutingConfigService });
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
  const httpExceptionFilter = new HttpExceptionFilter(publicApiMessageService);
  const adminBasicAuth = resolveAdminBasicAuth(options);
  const app = new BackendApplication(
    database,
    authService,
    getuiGyOneClickLoginService,
    commonGetuiGyConfigService,
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
    contentSafetyService,
    bodyLogProfileService,
    bodyLogSocialService,
    bodyLogLeaderboardService,
    bodyLogInvitationService,
    bodyLogChallengeService,
    llmSmokeTestService,
    aiNovelAuditFileService,
    aiNovelSkillService,
    aiNovelLlmService,
    aiPayloadCryptoService,
    storageService,
    clientLogUploadService,
    notificationService,
    failedEventRetryService,
    requestEmailContextService,
    requestLocaleService,
    publicApiMessageService,
    tencentSesEmailCallbackService,
    feedbackService,
    aiNovelStatisticsService,
    aiOutputReportingService,
    logger,
    auditInterceptor,
    requestLoggingInterceptor,
    httpExceptionFilter,
    appContextResolver,
    authGuard,
    appAccessGuard,
    rbacGuard,
    validationPipe,
    commonTestAccountService,
    kvManager,
    frogsleepEnabled,
    lighttickEnabled, lighttickRuntime,
  );
  app.analyticsService = analyticsService;
  return {
    app,
    telemetryGateway,
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
      commonSmsConfigService,
      commonAuthRateLimitConfigService,
      commonTestAccountService,
      commonGetuiGyConfigService,
      commonLlmConfigService,
      commonContentSafetyConfigService,
      appLogSecretService,
      adminSensitiveOperationService,
      appRegistryService,
      emailTestSendService,
      userService,
      appAiRoutingConfigService,
      aiNovelModelSelectionConfigService,
      tokenService,
      authService,
      getuiGyOneClickLoginService,
      qrLoginService,
      analyticsService,
      adminConsoleService,
      llmManager,
      embeddingManager,
      contentSafetyService,
      llmHealthService,
      llmMetricsService,
      llmObservabilityRetentionService,
      llmSmokeTestService,
      aiNovelAuditFileService,
      aiNovelSkillService,
      aiNovelLlmService,
      rbacService,
      storageService,
      clientLogUploadService,
      notificationService,
      buddyNotificationWorkerService,
      buddyInvitationEmailWorkerService,
      buddyMilestoneReportService,
      failedEventRetryService,
      tencentSesEmailCallbackService,
      feedbackService,
      aiNovelStatisticsService,
      smsVerificationSender,
      smsVerificationCleanupService,
      captchaVerificationService,
      requestEmailContextService,
      requestLocaleService,
      publicApiMessageService,
      i18nService,
      appContextResolver,
      authGuard,
      appAccessGuard,
      rbacGuard,
      lighttickRepository, lighttickRuntime,
    },
    close: async () => {
      await queue.close?.();
      await database.close();
    },
  };
}
