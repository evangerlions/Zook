import { beforeSearchDeadline } from "./search-deadline.ts";
import type { AccountRegion } from "../../../shared/types.ts";
import type { ContentSafetyService } from "../../../services/content-safety.service.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import { ApplicationError, isApplicationError } from "../../../shared/errors.ts";
import { isAiNovelToolVisible } from "../tools/ai-novel-tool-visibility.ts";
import { webSearchTool } from "../tools/web-search-tool.ts";
import { DeepSeekSearchClient } from "./deepseek-search-client.ts";
import { billingEnvironment } from "../../billing/billing-environment.ts";
import { searchCreditCharge } from "./search-credit-charge.ts";
import type { AiNovelCreditsService } from "../credits/ai-novel-credits.service.ts";
import { SearchConfigService, type SearchConfig } from "./search-config.ts";
import { SearchUsage } from "./search-usage.ts";
import { type SearchInput, type SearchOutcome, type SearchResult, type SearchUnavailableCode, SEARCH_SCENES } from "./search-types.ts";

export interface SearchRequestContext { userId: string; requestId: string; accountRegion: AccountRegion; appVersion?: string; signal?: AbortSignal }

interface SearchExecution {
  signal: AbortSignal; upstreamCalls: number; filteredCount: number;
  errorCode: SearchUnavailableCode; chargedPoints: number; billingStatus: "not_charged" | "charged" | "replayed" | "admin_test";
}

export class WebSearchService {
  constructor(
    readonly config: SearchConfigService,
    readonly usage: SearchUsage,
    private readonly credits: AiNovelCreditsService,
    private readonly safety: Pick<ContentSafetyService, "assertUserInputAllowed">,
    private readonly moderationReady: (textLength?: number) => Promise<boolean>,
    private readonly client = new DeepSeekSearchClient(),
    private readonly logger?: StructuredLogger,
  ) {}
  async available(region: AccountRegion = "UNKNOWN") {
    try {
      return await beforeSearchDeadline((async () => Boolean(await this.config.resolve(region)) && await this.moderationReady())(), AbortSignal.timeout(3000));
    } catch { return false; }
  }
  async execute(input: SearchInput, ctx: SearchRequestContext): Promise<SearchOutcome> {
    return this.run(input, ctx, false);
  }
  /** Only the authenticated Admin route calls this; client input cannot opt out. */
  async executeAdminTest(input: SearchInput, ctx: SearchRequestContext): Promise<SearchOutcome> {
    return this.run(input, ctx, true);
  }
  private async run(input: SearchInput, ctx: SearchRequestContext, adminTest: boolean): Promise<SearchOutcome> {
    if (!SEARCH_SCENES.includes(input.sceneKey) || !isAiNovelToolVisible(webSearchTool, { appVersion: ctx.appVersion, agentProtocol: input.agentProtocol }))
      throw new ApplicationError(400, "WEB_SEARCH_UNSUPPORTED", "Search is unavailable for this client or scene.");
    ctx.signal?.throwIfAborted();
    const started = Date.now();
    const state: SearchExecution = { signal: AbortSignal.any([AbortSignal.timeout(3000), ...(ctx.signal ? [ctx.signal] : [])]),
      upstreamCalls: 0, filteredCount: 0, errorCode: "UPSTREAM_UNAVAILABLE", chargedPoints: 0, billingStatus: adminTest ? "admin_test" : "not_charged" };
    let outcome: SearchOutcome = { status: "unavailable", code: "UPSTREAM_UNAVAILABLE" };
    let lease: { release: () => Promise<void> } | undefined;
    try {
      const resolved = await beforeSearchDeadline(this.config.resolve(ctx.accountRegion), state.signal);
      if (!resolved) return outcome;
      const { config, key } = resolved;
      state.signal = AbortSignal.any([AbortSignal.timeout(Math.max(1, config.totalTimeoutMs - (Date.now() - started))), ...(ctx.signal ? [ctx.signal] : [])]);
      const pointsPerSearch = config.pointsPerSearch;
      const charge = searchCreditCharge(input, pointsPerSearch);
      state.errorCode = "BILLING_UNAVAILABLE";
      if (!adminTest) {
        const admission = await beforeSearchDeadline(this.credits.checkFixedCharge(ctx.userId, ctx.requestId, charge, state.signal), state.signal);
        if (admission === "quota_insufficient") return outcome = { status: "unavailable", code: "CREDITS_INSUFFICIENT" };
        if (admission === "replayed") {
          state.billingStatus = "replayed";
          return outcome = await this.replay(input, ctx, state.signal);
        }
      }
      state.errorCode = "UPSTREAM_UNAVAILABLE";
      const pendingAdmission = this.usage.acquire(ctx.userId, config);
      void pendingAdmission.then(value => { if (state.signal.aborted && typeof value !== "string") void value.release().catch(() => {}); }, () => {});
      const admission = await beforeSearchDeadline(pendingAdmission, state.signal);
      lease = typeof admission === "string" ? undefined : admission;
      outcome = typeof admission === "string" ? { status: "unavailable", code: admission } : await this.search(input, ctx, config, key, state);
      ctx.signal?.throwIfAborted();
      if (!adminTest && outcome.status === "completed" && outcome.results.length) {
        state.errorCode = "BILLING_UNAVAILABLE";
        // Await the transaction itself: never return a timeout while a debit is still committing.
        const settled = await this.credits.settleFixedCharge(ctx.userId, ctx.requestId, charge, state.signal);
        if (settled === "quota_insufficient") return outcome = { status: "unavailable", code: "CREDITS_INSUFFICIENT" };
        state.billingStatus = settled === "charged" ? "charged" : "replayed";
        state.chargedPoints = settled === "charged" ? pointsPerSearch : 0;
      }
      return outcome;
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      const code = isApplicationError(error) && error.code === "AINOVEL_CREDITS_JOB_CONFLICT" ? "CALL_CONFLICT" : state.errorCode;
      this.logger?.warn("web_search stage failed", { requestId: ctx.requestId, code, errorName: error instanceof Error ? error.name : "unknown" });
      return outcome = { status: "unavailable", code };
    } finally {
      if (lease) { try { await beforeSearchDeadline(lease.release(), state.signal); } catch { /* The lease expires at the request deadline. */ } }
      await this.record(input, ctx, state, outcome, started);
    }
  }
  private async replay(input: SearchInput, ctx: SearchRequestContext, signal: AbortSignal): Promise<SearchOutcome> {
    const records = await beforeSearchDeadline(this.usage.records(), signal);
    const previous = records.find(row => row.userId === ctx.userId && row.toolCallId === input.toolCallId && row.billingEnvironment === billingEnvironment()
      && row.output?.status === "completed" && row.output.results.length);
    return previous?.output?.status === "completed" ? previous.output : { status: "unavailable", code: "CALL_CONFLICT" };
  }
  private async search(input: SearchInput, ctx: SearchRequestContext, config: SearchConfig, key: string, state: SearchExecution): Promise<SearchOutcome> {
    state.errorCode = "MODERATION_UNAVAILABLE";
    const query = await this.moderate(input.originalQuestion ? `${input.query}\n${input.originalQuestion}` : input.query, "web_search_query", ctx, state.signal);
    if (query === "blocked") return { status: "blocked", code: "CONTENT_BLOCKED" };
    if (query === "unavailable") return { status: "unavailable", code: "MODERATION_UNAVAILABLE" };
    state.signal.throwIfAborted();
    state.errorCode = "UPSTREAM_UNAVAILABLE";
    state.upstreamCalls++;
    const results = await this.client.search(input.query, Math.min(input.limit, config.maxResults), key, AbortSignal.any([state.signal, AbortSignal.timeout(config.upstreamTimeoutMs)]), input.originalQuestion);
    state.errorCode = "MODERATION_UNAVAILABLE";
    const accepted: SearchResult[] = [];
    for (const item of results) {
      const decision = await this.moderate(JSON.stringify(item), "web_search_result", ctx, state.signal);
      if (decision === "unavailable") return { status: "unavailable", code: "MODERATION_UNAVAILABLE" };
      if (decision === "allowed") accepted.push(item); else state.filteredCount++;
    }
    return accepted.length || !results.length ? { status: "completed", results: accepted } : { status: "blocked", code: "CONTENT_BLOCKED" };
  }
  private async record(input: SearchInput, ctx: SearchRequestContext, state: SearchExecution, outcome: SearchOutcome, started: number) {
    const record = { requestId: ctx.requestId, userId: ctx.userId, sceneKey: input.sceneKey, toolCallId: input.toolCallId,
      timestamp: new Date().toISOString(), status: ctx.signal?.aborted ? "cancelled" : outcome.status,
      ...("code" in outcome ? { code: outcome.code } : {}), returnedCount: outcome.status === "completed" ? outcome.results.length : 0,
      filteredCount: state.filteredCount, latencyMs: Date.now() - started, provider: "deepseek" as const, upstreamCalls: state.upstreamCalls,
      chargedPoints: state.chargedPoints, billingStatus: state.billingStatus, billingEnvironment: billingEnvironment() };
    this.logger?.info("web_search completed", record);
    const pending = this.usage.record({ ...record, input, output: ctx.signal?.aborted ? { status: "cancelled" } : outcome });
    void pending.catch(() => this.logger?.warn("web_search usage record failed", { requestId: ctx.requestId }));
    try { await beforeSearchDeadline(pending, state.signal); } catch { /* Audit write may still complete after cancellation. */ }
  }
  private async moderate(text: string, taskType: string, ctx: SearchRequestContext, signal: AbortSignal): Promise<"allowed" | "blocked" | "unavailable"> {
    signal.throwIfAborted();
    let onAbort: () => void = () => {};
    try {
      const result = await Promise.race([
        (async () => await this.moderationReady(text.length) ? this.safety.assertUserInputAllowed({ appId: "ai_novel", userId: ctx.userId, requestId: ctx.requestId, source: "business", taskType, text }) : undefined)(),
        new Promise<never>((_, reject) => { onAbort = () => reject(signal.reason); signal.addEventListener("abort", onAbort, { once: true }); if (signal.aborted) onAbort(); }),
      ]);
      signal.throwIfAborted();
      if (!result) return "unavailable";
      return !result.allowed ? "blocked" : ["disabled", "empty", "failed_open"].includes(result.layer) ? "unavailable" : "allowed";
    } catch (error) {
      if (signal.aborted) throw error;
      return isApplicationError(error) && error.code === "AI_INPUT_CONTENT_SENSITIVE" ? "blocked" : "unavailable";
    } finally { signal.removeEventListener("abort", onAbort); }
  }
}
