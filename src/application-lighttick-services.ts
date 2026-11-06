import {ResearchAIService} from "./modules/lighttick/investments/research-ai/research-ai.service.ts";
import {ResearchAIRunner} from "./modules/lighttick/investments/research-ai/research-ai.runner.ts";
import {GitHubService} from "./modules/lighttick/github/github.service.ts";
import {GitHubKeyResolver} from "./modules/lighttick/github/github.crypto.ts";
import {GitHubTestRunner} from "./modules/lighttick/github/github-test.runner.ts";
import {PersonalModelService} from "./modules/lighttick/personal-model/personal-model.service.ts";
import {PersonalModelDispatcher} from "./modules/lighttick/personal-model/personal-model.dispatcher.ts";
import {PersonalModelTestRunner} from "./modules/lighttick/personal-model/personal-model-test.runner.ts";
import {AesGcmPayloadCryptoService} from "./services/aes-gcm-payload-crypto.service.ts";
import {PersonalModelKeyResolver} from "./modules/lighttick/personal-model/personal-model.crypto.ts";
import {MarketWorkService} from "./modules/lighttick/investments/market/market-work.service.ts";
import {MarketWorkRunner} from "./modules/lighttick/investments/market/market-work.runner.ts";
import {MarketPolicyService} from "./modules/lighttick/investments/market/market-policy.service.ts";
import {DailyMarketAdapter} from "./modules/lighttick/investments/market/market.adapter.ts";
import type {VersionedAppConfigService} from "./services/versioned-app-config.service.ts";
import {InvestmentLedgerService} from "./modules/lighttick/investments/ledger.service.ts";
import {InvestmentLedgerRunner} from "./modules/lighttick/investments/ledger.runner.ts";
import {InMemoryDatabase} from "./testing/in-memory-database.ts";
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
import { LightTickJobService, LightTickWorker, LIGHTTICK_JOB_NAMES } from "./modules/lighttick/lighttick-worker.ts";
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
  const repository=override ?? (database instanceof PostgresDatabase
    ? database.getLightTickRepository()
    : new InMemoryLightTickRepository());
  if(database instanceof InMemoryDatabase)database.bindLightTickRepository(repository);return repository;
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
 appConfigService:VersionedAppConfigService;kvManager:KVManager;
  appAiRoutingConfigService: AppAiRoutingConfigService }) {
  const authorizeOwner=async(owner:import("./modules/lighttick/lighttick.types.ts").LightTickOwner)=>{
    const member=await input.database.findAppUser(owner.appId,owner.userId),user=await input.database.findUserById(owner.userId);
    if(member?.status!=='ACTIVE'||user?.status!=='ACTIVE')throw new ApplicationError(403,'APP_SCOPE_FORBIDDEN','The LightTick account is no longer active.');
  };
  const githubKeys=new GitHubKeyResolver(input.kvManager);
  const github=new GitHubService(input.repository,new AesGcmPayloadCryptoService(githubKeys),()=>githubKeys.ensure(),input.queue);
  input.runtime.github=github;
  const personalKeys=new PersonalModelKeyResolver(input.kvManager);
  const personal=new PersonalModelService(input.repository,new AesGcmPayloadCryptoService(personalKeys),()=>personalKeys.ensure(),input.queue);
  const personalLlm=new PersonalModelDispatcher(personal,input.llmManager);
  input.runtime.personalModel=personal;input.runtime.personalModelDispatcher=personalLlm;
  const researchAI=new ResearchAIService(input.repository,input.queue);input.runtime.researchAI=researchAI;
  const market=new MarketWorkService(input.repository,input.queue);
  const policy=new MarketPolicyService(input.appConfigService,input.kvManager);
  input.runtime.marketWork=market;input.runtime.marketPolicy=policy;
  const ledger=new InvestmentLedgerService(input.repository,input.queue);
  input.runtime.investmentLedger=ledger;
  const work=new LearningWorkService(new LearningRouteService(input.runtime.nativeLearning),input.queue);
  input.runtime.learningWork=work;
  const learning=new LearningWorkRunner(work,personalLlm,{
    readFile:(o,key)=>input.storageService.readOwnerText(input.fileStore,o,key),
    writeFile:(o,id,name,content)=>input.storageService.storeOwnerText(input.fileStore,o,name,content,id),
    fetchUrl:fetchLearningSource,
  },async owner=>{
    const member=await input.database.findAppUser(owner.appId,owner.userId),user=await input.database.findUserById(owner.userId);
    if(member?.status!=='ACTIVE'||user?.status!=='ACTIVE')throw new ApplicationError(403,'APP_SCOPE_FORBIDDEN','The LightTick account is no longer active.');
  },scene=>input.appAiRoutingConfigService.resolveLightTickScene(scene));
  input.runtime.worker = new LightTickWorker(new LightTickAiRunner(input.repository, personalLlm, undefined,
    scene => input.appAiRoutingConfigService.resolveLightTickScene(scene)),
    async job => {if(job.name===LIGHTTICK_JOB_NAMES.aiRun||job.name===LIGHTTICK_JOB_NAMES.retry)await new LightTickPlanningService(input.repository).failRun({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.run_id));},learning,new InvestmentLedgerRunner(ledger,authorizeOwner),new MarketWorkRunner(market,new DailyMarketAdapter(s=>policy.policy(s)),authorizeOwner),new PersonalModelTestRunner(personal,personalLlm,authorizeOwner),new GitHubTestRunner(github,authorizeOwner),new ResearchAIRunner(researchAI,personalLlm,authorizeOwner));
  input.runtime.notifications = new LightTickNotificationService(input.repository, input.queue,
    { dispatch: async request => await input.notificationService.dispatchPush(request) },
    async (payload, error) => await input.database.insertFailedEvent({ id: randomId("failed_event"), appId: "lighttick",
      eventType: "lighttick.notification.send", payload,
      errorMessage: error instanceof Error ? error.message : "LightTick notification enqueue failed",
      retryCount: 0, nextRetryAt: new Date(Date.now() + 60_000).toISOString(), createdAt: new Date().toISOString() }),
    undefined, input.runtime.analytics);
}
