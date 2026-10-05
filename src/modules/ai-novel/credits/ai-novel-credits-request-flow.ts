import type { LlmCallObservationRecord } from "../../../infrastructure/database/llm-observability-store.ts";
import type { AiNovelChatResponse, AiNovelChatStreamChunk, AiNovelEmbeddingsResponse } from "../ai-novel-llm-types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { AiNovelCreditsService } from "./ai-novel-credits.service.ts";
import type { AiNovelConversationRecordService } from "../ai-novel-conversation-record.service.ts";
import { extractAiNovelConversationRecordIds } from "../ai-novel-conversation-record-ids.ts";
import { latestUserMessageText, recordAiNovelConversationResult } from "../ai-novel-conversation-result.ts";
import { normalizeMessages, normalizeEmbeddingInput, requireSceneKey } from "../ai-novel-llm-request-validation.ts";
import { quotaReply, syntheticAiNovelReply } from "./synthetic-ai-novel-reply.ts";
import { startCreditsRequestLease } from "./credits-request-lease.ts";
import { randomId } from "../../../shared/utils.ts";

export interface CreditsRequestOptions {
  requestId?: string;
  userId?: string;
  locale?: string;
  signal?: AbortSignal;
  onUsageFinalized?: (record: LlmCallObservationRecord) => Promise<void>;
}

/** Server request admission; every successful provider call settles immediately. */
export class AiNovelCreditsRequestFlow {
  constructor(
    readonly credits: AiNovelCreditsService,
    readonly enabled: boolean,
    private readonly conversations?: AiNovelConversationRecordService,
  ) {}

  async embeddings<T extends CreditsRequestOptions>(body: Record<string, unknown>, options: T, execute: (options: T) => Promise<AiNovelEmbeddingsResponse>): Promise<AiNovelEmbeddingsResponse> {
    if (!this.enabled) return execute(options);
    const context = await this.admit(body, options, true);
    if (!context.allowed) throw this.denial(options);
    const lease = this.lease(options, context.jobId);
    const leasedOptions = { ...options, signal: lease.signal };
    let completed = false;
    try {
      const result = await execute(this.measuredOptions(leasedOptions, context.jobId));
      completed = true;
      return result;
    } finally { lease.stop(); await this.closeRequest(leasedOptions, context.jobId, completed); }
  }

  async complete<T extends CreditsRequestOptions>(body: Record<string, unknown>, options: T, execute: (options: T) => Promise<AiNovelChatResponse>): Promise<AiNovelChatResponse> {
    if (!this.enabled) return execute(options);
    const context = await this.admit(body, options);
    if (!context.allowed) {
      await this.recordDenied(body, options);
      throw this.denial(options);
    }
    const lease = this.lease(options, context.jobId);
    const leasedOptions = { ...options, signal: lease.signal };
    let completed = false;
    try {
      const result = await execute(this.measuredOptions(leasedOptions, context.jobId));
      completed = true;
      return result;
    } finally {
      lease.stop();
      await this.closeRequest(leasedOptions, context.jobId, completed);
    }
  }

  async *stream<T extends CreditsRequestOptions>(body: Record<string, unknown>, options: T, execute: (options: T) => AsyncIterable<AiNovelChatStreamChunk>): AsyncIterable<AiNovelChatStreamChunk> {
    if (!this.enabled) { yield* execute(options); return; }
    const context = await this.admit(body, options);
    if (!context.allowed) {
      await this.recordDenied(body, options);
      yield* syntheticAiNovelReply({ locale: options.locale, sceneKey: requireSceneKey(body), actionId: options.requestId!, signal: options.signal });
      return;
    }
    const lease = this.lease(options, context.jobId);
    const leasedOptions = { ...options, signal: lease.signal };
    let completed = false;
    try {
      for await (const chunk of execute(this.measuredOptions(leasedOptions, context.jobId))) {
        if (chunk.type === "done") {
          completed = true;
          // Release before the final frame; the next HTTP request may start immediately.
          lease.stop();
          await this.closeRequest(leasedOptions, context.jobId, completed);
        } else if (chunk.type === "error") {
          lease.stop();
          await this.closeRequest(leasedOptions, context.jobId, false);
        }
        yield chunk;
      }
    } finally {
      lease.stop();
      if (!completed) await this.closeRequest(leasedOptions, context.jobId, false);
    }
  }

  private async admit(body: Record<string, unknown>, options: CreditsRequestOptions, embedding = false) {
    requireSceneKey(body);
    if (embedding) normalizeEmbeddingInput(body.input); else normalizeMessages(body.messages);
    if (!options.userId || !options.requestId) {
      throw new ApplicationError(400, "AINOVEL_CREDITS_REQUEST_REQUIRED", "A server-authenticated user and request ID are required.");
    }
    // Client context (including legacy billingJobId/outcome) never controls accounting.
    const jobId = randomId("credit_request");
    return { jobId, allowed: await this.credits.begin(options.userId, jobId, options.requestId) === "allowed" };
  }

  private measuredOptions<T extends CreditsRequestOptions>(options: T, jobId: string): T {
    return { ...options, onUsageFinalized: async (record: LlmCallObservationRecord) => {
      await options.onUsageFinalized?.(record);
      if (record.outcome !== "success" || options.signal?.aborted) return;
      if (!record.pointPricing || record.pointMicros === undefined || record.promptTokens === undefined || record.completionTokens === undefined || record.totalTokens === undefined) {
        throw new ApplicationError(503, "AINOVEL_CREDITS_PRICE_UNAVAILABLE", "Successful AI usage cannot be priced safely.");
      }
      await this.credits.record(options.userId!, jobId, options.requestId!, {
        callId: record.callId, requestId: options.requestId, modelKey: record.routingModelKey,
        pricing: record.pointPricing, pointMicros: record.pointMicros,
        usage: { promptTokens: record.promptTokens, completionTokens: record.completionTokens, totalTokens: record.totalTokens,
          ...(record.cachedInputTokens === undefined ? {} : { cachedInputTokens: record.cachedInputTokens }),
          ...(record.reasoningTokens === undefined ? {} : { reasoningTokens: record.reasoningTokens }),
          ...(record.usageSource === "estimated" ? { estimated: true } : {}),
        },
      });
    } };
  }

  private async closeRequest(options: CreditsRequestOptions, jobId: string, completed: boolean) {
    await this.credits.closeRequest(options.userId!, jobId, options.requestId!,
      options.signal?.aborted ? "cancelled" : completed ? "success" : "failure");
  }

  private async recordDenied(body: Record<string, unknown>, options: CreditsRequestOptions) {
    await recordAiNovelConversationResult({ recordService: this.conversations, userId: options.userId, requestId: options.requestId,
      ...extractAiNovelConversationRecordIds(body), sceneKey: requireSceneKey(body), userText: latestUserMessageText(normalizeMessages(body.messages)),
      assistantText: "", outcome: "failure", errorCode: "quota_insufficient", serverCompacted: false,
    });
  }

  private denial(options: CreditsRequestOptions) {
    const reply = quotaReply(options.locale, options.requestId!);
    return new ApplicationError(402, "AINOVEL_QUOTA_INSUFFICIENT", reply.text, { clientAction: reply.action });
  }

  private lease(options: CreditsRequestOptions, jobId: string) {
    return startCreditsRequestLease(this.credits, options.userId!, jobId, options.requestId!, options.signal);
  }
}
