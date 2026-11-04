import { LightTickPlanningService } from "./modules/lighttick/planning/planning.service.ts";
import { LearningRouteService } from "./modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "./modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "./modules/lighttick/learning/learning-work.runner.ts";
import { fetchLearningSource } from "./modules/lighttick/learning/learning-sources.ts";
import type { StorageService } from "./infrastructure/files/storage.service.ts";
import type { PersistentFileStore } from "./infrastructure/files/persistent-file-store.ts";
import { ApplicationError } from "./shared/errors.ts";
import type { ApplicationDatabase } from "./infrastructure/database/application-database.ts";
import { PostgresDatabase } from "./infrastructure/database/postgres/postgres-database.ts";
import type { JobQueue } from "./infrastructure/queue/job-queue.ts";
import { LightTickAiRunner } from "./modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickNotificationService } from "./modules/lighttick/lighttick-notifications.ts";
import type { LightTickRepository } from "./modules/lighttick/lighttick.repository.ts";
import { createLightTickRuntime, type LightTickRuntime } from "./modules/lighttick/lighttick-runtime.ts";
import { LightTickJobService, LightTickWorker } from "./modules/lighttick/lighttick-worker.ts";
import type { LLMManager } from "./services/llm-manager.ts";
import type { NotificationService } from "./services/notification.service.ts";
import type { AppAiRoutingConfigService } from "./services/app-ai-routing-config.service.ts";
import type { AuthService } from "./modules/auth/auth.service.ts";
import type { AppRegistryService } from "./modules/app-registry/app-registry.service.ts";
import type { KVManager } from "./infrastructure/kv/kv-manager.ts";
import { LightTickGuestIdentityService } from "./modules/lighttick/lighttick-guest-identity.service.ts";
import { LightTickAccountUpgradeService } from "./modules/lighttick/lighttick-account-upgrade.service.ts";
import { randomId } from "./shared/utils.ts";
import { InMemoryLightTickRepository } from "./testing/in-memory-lighttick-repository.ts";
import type { AnalyticsService } from "./modules/analytics/analytics.service.ts";
import { LightTickAnalyticsService } from "./modules/lighttick/lighttick-analytics.ts";

export function resolveApplicationLightTickRepository(database: ApplicationDatabase, override?: LightTickRepository) {
  return override ?? (database instanceof PostgresDatabase
    ? database.getLightTickRepository()
    : new InMemoryLightTickRepository());
}

export function createApplicationLightTickRuntime(repository: LightTickRepository, queue: JobQueue) {
  const runtime = createLightTickRuntime(repository);
  runtime.jobs = new LightTickJobService(queue, repository);
  return runtime;
}

export function attachApplicationLightTickAccount(input: { runtime: LightTickRuntime; database: ApplicationDatabase;
  kv: KVManager; appRegistry: AppRegistryService; auth: AuthService; repository: LightTickRepository }) {
  input.runtime.guestIdentity = new LightTickGuestIdentityService(input.database, input.kv, input.appRegistry, input.auth, input.repository);
  input.runtime.accountUpgrade = new LightTickAccountUpgradeService(input.database, input.auth, input.repository);
}

export function attachApplicationLightTickAnalytics(runtime: LightTickRuntime, analytics: AnalyticsService) {
  runtime.analytics = new LightTickAnalyticsService(analytics);
}

export function attachApplicationLightTickWorkers(input: { runtime: LightTickRuntime; repository: LightTickRepository;
  queue: JobQueue; llmManager: LLMManager; notificationService: NotificationService; database: ApplicationDatabase;
  storageService: StorageService; fileStore: PersistentFileStore;
  appAiRoutingConfigService: AppAiRoutingConfigService }) {
  const work=new LearningWorkService(new LearningRouteService(input.runtime.nativeLearning),input.queue);
  input.runtime.learningWork=work;
  const learning=new LearningWorkRunner(work,input.llmManager,{
    readFile:(o,key)=>input.storageService.readOwnerText(input.fileStore,o,key),
    writeFile:(o,id,name,content)=>input.storageService.storeOwnerText(input.fileStore,o,name,content,id),
    fetchUrl:fetchLearningSource,
  },async owner=>{
    const member=await input.database.findAppUser(owner.appId,owner.userId),user=await input.database.findUserById(owner.userId);
    if(member?.status!=='ACTIVE'||user?.status!=='ACTIVE')throw new ApplicationError(403,'APP_SCOPE_FORBIDDEN','The LightTick account is no longer active.');
  },scene=>input.appAiRoutingConfigService.resolveLightTickScene(scene));
  input.runtime.worker = new LightTickWorker(new LightTickAiRunner(input.repository, input.llmManager, undefined,
    scene => input.appAiRoutingConfigService.resolveLightTickScene(scene)),
    async job => await new LightTickPlanningService(input.repository).failRun({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.run_id)),learning);
  input.runtime.notifications = new LightTickNotificationService(input.repository, input.queue,
    { dispatch: async request => await input.notificationService.dispatchPush(request) },
    async (payload, error) => await input.database.insertFailedEvent({ id: randomId("failed_event"), appId: "lighttick",
      eventType: "lighttick.notification.send", payload,
      errorMessage: error instanceof Error ? error.message : "LightTick notification enqueue failed",
      retryCount: 0, nextRetryAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() }),
    undefined, input.runtime.analytics);
}
