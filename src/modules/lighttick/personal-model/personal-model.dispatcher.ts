import { parseOpenAICompatibleChatUsage } from "../../../services/openai-compatible-usage.ts";
import type {
  LLMManager,
  LLMCompletionRequest,
  LLMCompletionResult,
} from "../../../services/llm-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import {
  object,
  integer,
  fail,
} from "../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type { ModelTest, ModelSelection } from "./personal-model.types.ts";
import { PersonalModelService } from "./personal-model.service.ts";
import { fetchPersonalModel } from "./personal-model.transport.ts";
export const MODEL_SELECTION_OPTION = "zookLightTickModelSelection";
export const selectionOption = (selection: unknown) =>
  !selection || (selection as any).mode === "platform"
    ? {}
    : { [MODEL_SELECTION_OPTION]: selection };
export class PersonalModelDispatcher implements Pick<LLMManager, "complete"> {
  constructor(
    readonly settings: PersonalModelService,
    readonly platform: Pick<LLMManager, "complete">,
    readonly transport: typeof fetchPersonalModel = fetchPersonalModel,
    readonly timeoutMs = 45000,
  ) {}
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const options = { ...request.providerOptions },
      raw = options[MODEL_SELECTION_OPTION];
    delete options[MODEL_SELECTION_OPTION];
    const selection =
      raw === undefined
        ? { mode: "platform" as const, revision: 0 }
        : object(raw);
    if (selection.mode === "platform")
      return this.platform.complete({ ...request, providerOptions: options });
    if (selection.mode !== "personal") fail(422, "模型选择无效。");
    const revision = integer(selection.revision, 1, 2147483647),
      o = request.usageOwner;
    if (o?.appId !== "lighttick" || !o.userId)
      fail(403, "个人模型仅限当前 LightTick 账号。");
    return this.personal(
      { appId: "lighttick", userId: o.userId },
      { mode: "personal", revision },
      { ...request, providerOptions: options },
    );
  }
  async personal(
    o: LightTickOwner,
    selection: ModelSelection,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResult> {
    return this.perform(
      request,
      () => this.settings.credentials(o, selection),
      () => this.settings.assertCurrent(o, selection),
    );
  }
  async test(
    row: ModelTest,
    request: LLMCompletionRequest,
  ): Promise<LLMCompletionResult> {
    return this.perform(
      request,
      () => this.settings.testCredentials(row),
      () => this.settings.assertRevision(row, row.settings_revision),
    );
  }
  private async perform(
    request: LLMCompletionRequest,
    credentials: () => Promise<{
      base_url: string;
      model_name: string;
      api_key: string;
    }>,
    check: () => Promise<void>,
  ): Promise<LLMCompletionResult> {
    const controller = new AbortController(),
      signal = request.signal
        ? AbortSignal.any([request.signal, controller.signal])
        : controller.signal;
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(45000, Math.max(1, this.timeoutMs)),
    );
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => {
      abort = () =>
        reject(
          new ApplicationError(
            504,
            "LLM_PROVIDER_REQUEST_FAILED",
            "个人模型请求已取消或超时；未切换模型。",
          ),
        );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    try {
      const result = await Promise.race([
        (async () => {
          const cfg = await credentials();
          signal.throwIfAborted();
          const response = await this.transport(
            cfg.base_url + "/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: "Bearer " + cfg.api_key,
              },
              body: JSON.stringify({
                model: cfg.model_name,
                messages: request.messages,
                max_tokens: Math.min(request.maxTokens ?? 8192, 8192),
                temperature: request.temperature ?? 0.2,
                stream: false,
                ...(request.providerOptions?.response_format
                  ? { response_format: request.providerOptions.response_format }
                  : {}),
              }),
            },
            signal,
          );
          if (!response.ok) throw Error("MODEL_RESPONSE_FAILED");
          const payload = await response.json(),
            choice = payload?.choices?.[0];
          signal.throwIfAborted();
          if (
            payload.error ||
            choice?.finish_reason !== "stop" ||
            typeof choice.message?.content !== "string" ||
            !choice.message.content.trim() ||
            choice.message.tool_calls?.length
          )
            throw Error("MODEL_RESPONSE_INCOMPLETE");
          const value: LLMCompletionResult = {
            provider: "personal",
            modelKey: "lighttick.personal",
            providerModel: cfg.model_name,
            text: choice.message.content,
            finishReason: "stop",
            usage: parseOpenAICompatibleChatUsage(payload.usage, "personal"),
          };
          await check();
          return value;
        })(),
        cancelled,
      ]);
      return result;
    } catch (error) {
      if (
        error instanceof ApplicationError &&
        [403, 409, 503, 504].includes(error.statusCode)
      )
        throw error;
      throw new ApplicationError(
        502,
        "LLM_PROVIDER_REQUEST_FAILED",
        "个人模型调用未成功或响应不完整；没有改用其他模型。",
      );
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
}
