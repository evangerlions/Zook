import { beforeSearchDeadline } from "./search-deadline.ts";
import type { AccountRegion } from "../../../shared/types.ts";
import type { ContentSafetyService } from "../../../services/content-safety.service.ts";
import type { StructuredLogger } from "../../../infrastructure/logging/pino-logger.module.ts";
import { ApplicationError, isApplicationError } from "../../../shared/errors.ts";
import { isAiNovelToolVisible } from "../tools/ai-novel-tool-visibility.ts";
import { webSearchTool } from "../tools/web-search-tool.ts";
import { DeepSeekSearchClient } from "./deepseek-search-client.ts";
import { SearchConfigService } from "./search-config.ts";
import { SearchUsage } from "./search-usage.ts";
import { type SearchInput, type SearchOutcome, type SearchResult, SEARCH_SCENES } from "./search-types.ts";

export interface SearchRequestContext { userId: string; requestId: string; accountRegion: AccountRegion; appVersion?: string; signal?: AbortSignal }

export class WebSearchService {
  constructor(
    readonly config: SearchConfigService,
    readonly usage: SearchUsage,
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
    if (!SEARCH_SCENES.includes(input.sceneKey) || !isAiNovelToolVisible(webSearchTool, { appVersion: ctx.appVersion, agentProtocol: input.agentProtocol })) {
      throw new ApplicationError(400, "WEB_SEARCH_UNSUPPORTED", "Search is unavailable for this client or scene.");
    }
    ctx.signal?.throwIfAborted();
    const started = Date.now();
    const setupSignal = AbortSignal.any([AbortSignal.timeout(3000), ...(ctx.signal ? [ctx.signal] : [])]);
    let signal = setupSignal;
    let upstreamCalls = 0, filteredCount = 0;
    let outcome: SearchOutcome = { status: "unavailable", code: "UPSTREAM_UNAVAILABLE" };
    let lease: { release: () => Promise<void> } | undefined;
    let moderationStage = false;
    try {
      const resolved = await beforeSearchDeadline(this.config.resolve(ctx.accountRegion), setupSignal);
      if (!resolved) return outcome;
      const { config, key } = resolved;
      signal = AbortSignal.any([AbortSignal.timeout(Math.max(1, config.totalTimeoutMs - (Date.now() - started))), ...(ctx.signal ? [ctx.signal] : [])]);
      const pendingAdmission = this.usage.acquire(ctx.userId, config);
      void pendingAdmission.then(value => { if (signal.aborted && typeof value !== "string") void value.release().catch(() => {}); }, () => {});
      const admission = await beforeSearchDeadline(pendingAdmission, signal);
      lease = typeof admission === "string" ? undefined : admission;
      if (typeof admission === "string") outcome = { status: "unavailable", code: admission };
      else {
        moderationStage = true;
        const queryDecision = await this.moderate(input.originalQuestion ? `${input.query}\n${input.originalQuestion}` : input.query, "web_search_query", ctx, signal);
        if (queryDecision === "blocked") outcome = { status: "blocked", code: "CONTENT_BLOCKED" };
        else if (queryDecision === "unavailable") outcome = { status: "unavailable", code: "MODERATION_UNAVAILABLE" };
        else {
          signal.throwIfAborted();
          moderationStage = false;
          upstreamCalls = 1;
          const results = await this.client.search(input.query, Math.min(input.limit, config.maxResults), key, AbortSignal.any([signal, AbortSignal.timeout(config.upstreamTimeoutMs)]), input.originalQuestion);
          moderationStage = true;
          const accepted: SearchResult[] = [];
          for (const item of results) {
            const decision = await this.moderate(JSON.stringify(item), "web_search_result", ctx, signal);
            if (decision === "unavailable") { outcome = { status: "unavailable", code: "MODERATION_UNAVAILABLE" }; break; }
            if (decision === "allowed") accepted.push(item); else filteredCount++;
            if (accepted.length + filteredCount === results.length) outcome = accepted.length || !results.length ? { status: "completed", results: accepted } : { status: "blocked", code: "CONTENT_BLOCKED" };
          }
          if (!results.length) outcome = { status: "completed", results: [] };
        }
      }
      ctx.signal?.throwIfAborted();
      return outcome;
    } catch (error) {
      if (ctx.signal?.aborted) throw error;
      return outcome = { status: "unavailable", code: moderationStage ? "MODERATION_UNAVAILABLE" : "UPSTREAM_UNAVAILABLE" };
    } finally {
      if (lease) { try { await beforeSearchDeadline(lease.release(), signal); } catch { /* Lease expires at the request deadline. */ } }
      const record = { requestId: ctx.requestId, userId: ctx.userId, sceneKey: input.sceneKey, toolCallId: input.toolCallId, timestamp: new Date().toISOString(), status: ctx.signal?.aborted ? "cancelled" : outcome.status, ...("code" in outcome ? { code: outcome.code } : {}), returnedCount: outcome.status === "completed" ? outcome.results.length : 0, filteredCount, latencyMs: Date.now() - started, provider: "deepseek" as const, upstreamCalls };
      this.logger?.info("web_search completed", record);
      const pendingRecord = this.usage.record({ ...record, input, output: ctx.signal?.aborted ? { status: "cancelled" } : outcome });
      void pendingRecord.catch(() => this.logger?.warn("web_search usage record failed", { requestId: ctx.requestId }));
      try { await beforeSearchDeadline(pendingRecord, signal); } catch { /* Cancellation does not imply that the audit write failed. */ }
    }
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
