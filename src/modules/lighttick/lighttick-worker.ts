import type {PortfolioRunner} from "./investments/portfolio/portfolio.runner.ts";
import {PORTFOLIO_JOB} from "./investments/portfolio/portfolio.service.ts";
import type {StrategyRunner} from "./investments/strategies/strategy.runner.ts";
import {BACKTEST_JOB} from "./investments/strategies/strategy.service.ts";
import type {ObservationRunner} from "./investments/observations/observation.runner.ts";
import {OBSERVATION_JOB} from "./investments/observations/observation.work-service.ts";
import type {ScreeningRunner} from "./investments/screening/screen.runner.ts";
import {SCREEN_JOB} from "./investments/screening/screen.service.ts";
import {ResearchAIRunner} from "./investments/research-ai/research-ai.runner.ts";
import {RESEARCH_AI_JOB} from "./investments/research-ai/research-ai.service.ts";
import type {GitHubTestRunner} from "./github/github-test.runner.ts";
import {GITHUB_TEST_JOB} from "./github/github.service.ts";
import type {PersonalModelTestRunner} from "./personal-model/personal-model-test.runner.ts";
import {MODEL_TEST_JOB} from "./personal-model/personal-model.service.ts";
import type {MarketWorkRunner} from "./investments/market/market-work.runner.ts";
import {MARKET_WORK_JOB} from "./investments/market/market-work.service.ts";
import {InvestmentLedgerRunner} from "./investments/ledger.runner.ts";
import {INVESTMENT_LEDGER_JOB} from "./investments/ledger.service.ts";
import type { JobQueue } from "../../infrastructure/queue/job-queue.ts";
import type { QueueJob } from "../../shared/types.ts";
import { sha256 } from "../../shared/utils.ts";
import type { LightTickAiRunner } from "./ai/lighttick-ai-runner.ts";
import type { LightTickAiSceneName } from "./ai/lighttick-ai-scenes.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickOwner } from "./lighttick.types.ts";
import type { LearningWorkRunner } from "./learning/learning-work.runner.ts";
import { LEARNING_WORK_JOB } from "./learning/learning-work.service.ts";

export const LIGHTTICK_JOB_NAMES = {
  aiRun: "lighttick.ai.run", notification: "lighttick.notification.schedule",
  aggregate: "lighttick.execution.aggregate", retry: "lighttick.ai.retry",
} as const;

export class LightTickJobService {
  constructor(private readonly queue: JobQueue, private readonly repository: LightTickRepository,
    private readonly clock = () => new Date()) {}

  async enqueueAiRun(owner: LightTickOwner, runId: string, scene: LightTickAiSceneName) {
    return await this.enqueueOnce(owner, `ai:${runId}`, LIGHTTICK_JOB_NAMES.aiRun, { app_id: owner.appId, user_id: owner.userId, run_id: runId, scene });
  }
  async enqueueReview(owner: LightTickOwner, runId: string, scene: "daily_review" | "weekly_review" | "monthly_review") {
    return await this.enqueueAiRun(owner, runId, scene);
  }
  async enqueueNotification(owner: LightTickOwner, notificationKey: string, businessDate: string) {
    return await this.enqueueOnce(owner, `notification:${notificationKey}:${businessDate}`, LIGHTTICK_JOB_NAMES.notification,
      { app_id: owner.appId, user_id: owner.userId, notification_key: notificationKey, business_date: businessDate });
  }
  async enqueueAggregation(owner: LightTickOwner, businessDate: string) {
    return await this.enqueueOnce(owner, `aggregate:${businessDate}`, LIGHTTICK_JOB_NAMES.aggregate,
      { app_id: owner.appId, user_id: owner.userId, business_date: businessDate });
  }
  private async enqueueOnce(owner: LightTickOwner, operationId: string, name: string, payload: Record<string, unknown>) {
    const existing = await this.repository.getOperation(owner, operationId);
    if (existing) return existing.resultPayload;
    const job = await this.queue.add(name, payload, { attempts: 3, backoffMs: 1000,
      jobId: `lighttick_job_${sha256(`${owner.appId}:${owner.userId}:${operationId}`).slice(0, 32)}` }); const now = this.clock().toISOString();
    const result = { job_id: job.id, name: job.name };
    await this.repository.saveOperation({ ...owner, operationId, deviceId: "worker", payloadHash: sha256(JSON.stringify(payload)),
      entityType: "job", entityId: job.id, action: "enqueue", requestPayload: payload, resultPayload: result,
      status: "accepted", createdAt: now, updatedAt: now });
    return result;
  }
}

export class LightTickWorker {
  constructor(private readonly aiRunner: LightTickAiRunner,
    private readonly recordTerminalFailure: (job: QueueJob, error: unknown) => Promise<void> = async () => undefined,
    readonly learning?:LearningWorkRunner,readonly investments?:InvestmentLedgerRunner,readonly market?:MarketWorkRunner,readonly modelTests?:PersonalModelTestRunner,readonly githubTests?:GitHubTestRunner,readonly researchAI?:ResearchAIRunner,readonly screening?:ScreeningRunner,readonly observations?:ObservationRunner,readonly strategies?:StrategyRunner,readonly portfolio?:PortfolioRunner) {}

  async recover(){return (await this.learning?.recover()??0)+(await this.investments?.recover()??0)+(await this.market?.recover()??0)+(await this.modelTests?.recover()??0)+(await this.githubTests?.recover()??0)+(await this.researchAI?.recover()??0)+(await this.screening?.recover()??0)+(await this.observations?.recover()??0)+(await this.strategies?.recover()??0)+(await this.portfolio?.recover()??0);}

  async process(job: QueueJob): Promise<void> {
    try {
      if(job.name===PORTFOLIO_JOB){if(!this.portfolio||job.payload.app_id!=="lighttick")throw Error("Portfolio worker unavailable");await this.portfolio.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===BACKTEST_JOB){if(!this.strategies||job.payload.app_id!=="lighttick")throw Error("Strategy worker unavailable");await this.strategies.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===OBSERVATION_JOB){if(!this.observations||job.payload.app_id!=="lighttick")throw Error("Observation worker unavailable");await this.observations.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===SCREEN_JOB){if(!this.screening||job.payload.app_id!=="lighttick")throw Error("Screening unavailable");await this.screening.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===RESEARCH_AI_JOB){if(!this.researchAI||job.payload.app_id!=="lighttick")throw Error("Research AI unavailable");await this.researchAI.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===GITHUB_TEST_JOB){if(!this.githubTests||job.payload.app_id!=="lighttick")throw Error("GitHub worker unavailable");await this.githubTests.execute({appId:"lighttick",userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===MODEL_TEST_JOB){if(!this.modelTests||job.payload.app_id!=='lighttick')throw Error('Personal model worker unavailable');await this.modelTests.execute({appId:'lighttick',userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===MARKET_WORK_JOB){if(!this.market||job.payload.app_id!=='lighttick')throw Error('Market worker unavailable or invalid scope');await this.market.execute({appId:'lighttick',userId:String(job.payload.user_id)},String(job.payload.work_id));return;}
      if(job.name===INVESTMENT_LEDGER_JOB){
        if(!this.investments||job.payload.app_id!=='lighttick')throw Error('Investment worker is unavailable or has invalid app scope');
        await this.investments.execute({appId:'lighttick',userId:String(job.payload.user_id)},String(job.payload.work_id));return;
      }
      if(job.name===LEARNING_WORK_JOB){
        if(!this.learning||job.payload.app_id!=='lighttick')throw Error('Learning worker is unavailable or has invalid app scope');
        await this.learning.execute({appId:'lighttick',userId:String(job.payload.user_id)},String(job.payload.work_id));return;
      }
      if (job.name === LIGHTTICK_JOB_NAMES.aiRun || job.name === LIGHTTICK_JOB_NAMES.retry) {
        const owner: LightTickOwner = { appId: "lighttick", userId: String(job.payload.user_id) };
        await this.aiRunner.execute(owner, String(job.payload.run_id), String(job.payload.scene) as LightTickAiSceneName);
        return;
      }
      if ([LIGHTTICK_JOB_NAMES.notification, LIGHTTICK_JOB_NAMES.aggregate].includes(job.name as any)) return;
      throw new Error(`Unsupported LightTick job: ${job.name}`);
    } catch (error) {
      if (job.attemptsMade + 1 >= job.maxAttempts) await this.recordTerminalFailure(job, error);
      throw error;
    }
  }
}

export function nextLightTickLocalSchedule(now: Date, timezone: string, hour: number, minute = 0): Date {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59)
    throw new Error("Schedule time is invalid.");
  const formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const parts = Object.fromEntries(formatter.formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const currentMinutes = Number(parts.hour) * 60 + Number(parts.minute); const addDays = currentMinutes < hour * 60 + minute ? 0 : 1;
  const targetLocal = new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`); targetLocal.setUTCDate(targetLocal.getUTCDate() + addDays);
  const guess = new Date(targetLocal.getTime() + (hour * 60 + minute) * 60_000);
  const guessParts = Object.fromEntries(formatter.formatToParts(guess).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const observedUtcLike = Date.UTC(Number(guessParts.year), Number(guessParts.month) - 1, Number(guessParts.day), Number(guessParts.hour), Number(guessParts.minute));
  const desiredUtcLike = Date.UTC(targetLocal.getUTCFullYear(), targetLocal.getUTCMonth(), targetLocal.getUTCDate(), hour, minute);
  return new Date(guess.getTime() + desiredUtcLike - observedUtcLike);
}
