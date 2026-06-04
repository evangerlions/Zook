import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { OpenAICompatibleResponsePayload } from "./bailian-openai-compatible-types.ts";
import { redactProviderRequestBody } from "./bailian-openai-compatible-utils.ts";

export class BailianOpenAICompatibleLocalLogger {
  constructor(private readonly logger?: StructuredLogger) {}

  chatRequest(input: {
    mode: "complete" | "stream";
    url: string;
    modelKey: string;
    providerModel: string;
    body: Record<string, unknown>;
    redactBody?: boolean;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.info("ai_novel local provider chat request body", {
      mode: input.mode,
      url: input.url,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      body: input.redactBody
        ? redactProviderRequestBody(input.body)
        : input.body,
    });
  }

  rawStreamChunk(input: {
    modelKey: string;
    providerModel: string;
    chunk: string;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.info("ai_novel local provider raw stream chunk", {
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      chunk: input.chunk,
    });
  }

  chatResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    const choice = input.payload.choices?.[0];
    this.logger.info("ai_novel local provider chat response body", {
      mode: input.mode,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      id: input.payload.id,
      finishReason: choice?.finish_reason,
      contentPreview:
        typeof choice?.message?.content === "string"
          ? choice.message.content.slice(0, 500)
          : choice?.message?.content,
      toolCalls: choice?.message?.tool_calls?.map((toolCall) => ({
        id: toolCall.id,
        name: toolCall.function?.name,
        argumentsPreview: toolCall.function?.arguments?.slice(0, 500),
      })),
      usage: input.payload.usage,
    });
  }

  chatErrorResponse(input: {
    mode: "complete";
    modelKey: string;
    providerModel: string;
    statusCode: number;
    payload: OpenAICompatibleResponsePayload;
  }): void {
    if (!this.logger || !shouldLogLocalProviderTraffic()) {
      return;
    }
    this.logger.warn("ai_novel local provider chat error response body", {
      mode: input.mode,
      modelKey: input.modelKey,
      providerModel: input.providerModel,
      statusCode: input.statusCode,
      error: input.payload.error,
      message: input.payload.message,
      id: input.payload.id,
    });
  }
}

function shouldLogLocalProviderTraffic(): boolean {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "").trim().toLowerCase();
  return (
    appEnv === "local" ||
    appEnv === "dev" ||
    appEnv === "development" ||
    nodeEnv === "development"
  );
}
