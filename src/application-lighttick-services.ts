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
import { randomId } from "./shared/utils.ts";
import { InMemoryLightTickRepository } from "./testing/in-memory-lighttick-repository.ts";

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

export function attachApplicationLightTickWorkers(input: { runtime: LightTickRuntime; repository: LightTickRepository;
  queue: JobQueue; llmManager: LLMManager; notificationService: NotificationService; database: ApplicationDatabase;
  appAiRoutingConfigService: AppAiRoutingConfigService }) {
  input.runtime.worker = new LightTickWorker(new LightTickAiRunner(input.repository, input.llmManager, undefined,
    scene => input.appAiRoutingConfigService.resolveLightTickScene(scene)));
  input.runtime.notifications = new LightTickNotificationService(input.repository, input.queue,
    { dispatch: async request => await input.notificationService.dispatchPush(request) },
    async (payload, error) => await input.database.insertFailedEvent({ id: randomId("failed_event"), appId: "lighttick",
      eventType: "lighttick.notification.send", payload,
      errorMessage: error instanceof Error ? error.message : "LightTick notification enqueue failed",
      retryCount: 0, nextRetryAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() }));
}
