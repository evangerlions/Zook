import type {
  LlmCallObservationRecord,
  LlmObservabilityStore,
  LlmOperation,
  LlmResponseMode,
} from "../infrastructure/database/llm-observability-store.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import { ApplicationError } from "../shared/errors.ts";
import { randomId } from "../shared/utils.ts";
import type { LLMUsage } from "./llm-manager-types.ts";

interface LlmCallObservationContext {
  appId?: string;
  routingModelKey: string;
  provider: string;
  providerModel: string;
  operation: LlmOperation;
  responseMode: LlmResponseMode;
  routingConfigRevision?: number;
  startedAt: Date;
  now?: () => Date;
}

interface LlmCallFinalization {
  outcome?: LlmCallObservationRecord["outcome"];
  usage?: LLMUsage;
  error?: unknown;
  completedAt?: Date;
}

export class LlmCallObservationRecorder {
  constructor(
    private readonly store: LlmObservabilityStore,
    private readonly logger?: StructuredLogger,
  ) {}

  start(context: LlmCallObservationContext): LlmCallObservationSession {
    return new LlmCallObservationSession(this.store, context, this.logger);
  }
}

export class LlmCallObservationSession {
  private readonly callId = randomId("llm_call");
  private firstResponseAt?: Date;
  private finalized = false;

  constructor(
    private readonly store: LlmObservabilityStore,
    private readonly context: LlmCallObservationContext,
    private readonly logger?: StructuredLogger,
  ) {}

  markFirstResponse(at = this.getNow()): void {
    this.firstResponseAt ??= at;
  }

  get isFinalized(): boolean {
    return this.finalized;
  }

  async finalize(input: LlmCallFinalization = {}): Promise<void> {
    if (this.finalized) return;
    this.finalized = true;
    const completedAt = input.completedAt ?? this.getNow();
    const classification = classifyFinalization(input);
    const usage = input.usage;
    const record: LlmCallObservationRecord = {
      callId: this.callId,
      occurredAt: completedAt.toISOString(),
      ...(this.context.appId ? { appId: this.context.appId } : {}),
      routingModelKey: this.context.routingModelKey,
      provider: this.context.provider,
      providerModel: this.context.providerModel,
      operation: this.context.operation,
      responseMode: this.context.responseMode,
      outcome: classification.outcome,
      healthImpact: classification.healthImpact,
      firstResponseLatencyMs: this.firstResponseAt
        ? elapsedMs(this.context.startedAt, this.firstResponseAt)
        : undefined,
      totalLatencyMs: elapsedMs(this.context.startedAt, completedAt),
      promptTokens: usage?.promptTokens,
      completionTokens: usage?.completionTokens,
      reasoningTokens: usage?.reasoningTokens,
      totalTokens: usage?.totalTokens,
      usageSource: usage ? usage.estimated ? "estimated" : "provider" : "missing",
      errorCode: classification.errorCode,
      errorMessage: classification.errorMessage,
      routingConfigRevision: this.context.routingConfigRevision,
    };
    try {
      await this.store.recordObservation(record);
    } catch (error) {
      this.logger?.warn("failed to persist LLM call observation", {
        callId: this.callId,
        routingModelKey: this.context.routingModelKey,
        provider: this.context.provider,
        providerModel: this.context.providerModel,
        operation: this.context.operation,
        outcome: classification.outcome,
        error,
      });
    }
  }

  private getNow(): Date {
    return this.context.now?.() ?? new Date();
  }
}

function classifyFinalization(input: LlmCallFinalization): {
  outcome: LlmCallObservationRecord["outcome"];
  healthImpact: LlmCallObservationRecord["healthImpact"];
  errorCode?: string;
  errorMessage?: string;
} {
  if (input.outcome === "cancelled") {
    return { outcome: "cancelled", healthImpact: "neutral" };
  }
  if (!input.error) {
    return { outcome: input.outcome ?? "success", healthImpact: "success" };
  }
  const applicationError = input.error instanceof ApplicationError ? input.error : undefined;
  const applicationErrorCode = applicationError?.code;
  const providerErrorCode = readDetailString(applicationError?.details, "errorCode");
  const errorCode = providerErrorCode ?? applicationErrorCode ??
    (input.error instanceof Error ? input.error.name : "UNKNOWN_ERROR");
  const errorMessage = sanitizeErrorMessage(
    input.error instanceof Error ? input.error.message : String(input.error),
  );
  if (applicationErrorCode === "LLM_PROVIDER_CONTENT_SENSITIVE") {
    return { outcome: "failure", healthImpact: "neutral", errorCode };
  }
  const timeout = applicationError?.statusCode === 504 ||
    readDetailString(applicationError?.details, "reason") === "timeout" ||
    readDetailString(applicationError?.details, "reason") === "first_byte_timeout";
  return {
    outcome: timeout ? "timeout" : input.outcome ?? "failure",
    healthImpact: "failure",
    errorCode,
    errorMessage,
  };
}

function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[redacted]")
    .replace(/((?:api[-_ ]?key|authorization|access[-_ ]?token)\s*[:=]\s*)[^\s,;]+/gi, "$1[redacted]")
    .replace(/([?&](?:api_key|key|token)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

function readDetailString(details: unknown, key: string): string | undefined {
  if (!details || typeof details !== "object" || Array.isArray(details)) return undefined;
  const value = (details as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function elapsedMs(start: Date, end: Date): number {
  return Math.max(0, Math.round(end.getTime() - start.getTime()));
}
