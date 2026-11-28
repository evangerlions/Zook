import { parseOpenAICompatibleChatUsage } from "../../../services/openai-compatible-usage.ts";
import { randomUUID } from "node:crypto";
import type { LlmCallOutcome, LlmObservabilityStore, LlmResponseMode } from "../../../infrastructure/database/llm-observability-store.ts";
import { dashscopeThinkingOptions } from "./personal-model-thinking.ts";
import type {
  LLMManager,
  LLMCompletionRequest,
  LLMCompletionResult,
  LLMCompleteViaStreamOptions,
  LLMStreamingCompletionCapability,
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
import { streamPersonalModel } from "./personal-model.stream-transport.ts";
import { readPersonalModelStream } from "./personal-model.stream.ts";
export const MODEL_SELECTION_OPTION = "zookLightTickModelSelection";
export const selectionOption = (selection: unknown) =>
  !selection || (selection as any).mode === "platform"
    ? {}
    : { [MODEL_SELECTION_OPTION]: selection };
// Ark Chat API uses thinking.type; keep the scene's bounded no-thinking request.
export function personalThinkingOptions(baseUrl: string, options: Record<string, unknown> = {}) {
  const host = new URL(baseUrl).hostname;
  return (host === "volces.com" || host.endsWith(".volces.com")) && options.enable_thinking === false
    ? { thinking: { type: "disabled" } } : {};
}
type PersonalTransport = typeof fetchPersonalModel;
interface PersonalMode {
  stream: boolean;
  transport: PersonalTransport;
  onContentDelta?: (delta: string, fullText: string) => void;
}
type Routed =
  | { mode: "platform"; request: LLMCompletionRequest }
  | {
      mode: "personal";
      owner: LightTickOwner;
      selection: ModelSelection;
      request: LLMCompletionRequest;
    };
const BUFFERED: PersonalMode = { stream: false, transport: fetchPersonalModel };
export class PersonalModelDispatcher
  implements Pick<LLMManager, "complete">, LLMStreamingCompletionCapability
{
  constructor(
    readonly settings: PersonalModelService,
    readonly platform: Pick<LLMManager, "complete"> &
      LLMStreamingCompletionCapability,
    readonly transport: PersonalTransport = fetchPersonalModel,
    readonly timeoutMs = 45000,
    /**
     * A caller that injects its own transport (tests, alternate gateways) means
     * "talk to the endpoint this way", so streaming reuses it and only the real
     * default transport is upgraded to the streaming one.
     */
    readonly streamTransport: PersonalTransport = transport === fetchPersonalModel
      ? streamPersonalModel
      : transport,
    /**
     * 个人额度的调用原先完全不进观测表，真实 token 与花费无法核对。
     * 注入 store 后每次调用尽力写一条；store 缺失时保持旧行为。
     */
    readonly observations?: LlmObservabilityStore,
    readonly now: () => Date = () => new Date(),
  ) {}
  /** Selection parsing shared by the buffered and streaming entry points. */
  private route(request: LLMCompletionRequest): Routed {
    const options = { ...request.providerOptions },
      raw = options[MODEL_SELECTION_OPTION];
    delete options[MODEL_SELECTION_OPTION];
    const selection =
      raw === undefined
        ? { mode: "platform" as const, revision: 0 }
        : object(raw);
    const stripped = { ...request, providerOptions: options };
    if (selection.mode === "platform")
      return { mode: "platform", request: stripped };
    if (selection.mode !== "personal") fail(422, "模型选择无效。");
    const revision = integer(selection.revision, 1, 2147483647),
      o = request.usageOwner;
    if (o?.appId !== "lighttick" || !o.userId)
      fail(403, "个人模型仅限当前 LightTick 账号。");
    return {
      mode: "personal",
      owner: { appId: "lighttick", userId: o!.userId } as LightTickOwner,
      selection: { mode: "personal", revision } as ModelSelection,
      request: stripped,
    };
  }
  async complete(request: LLMCompletionRequest): Promise<LLMCompletionResult> {
    const routed = this.route(request);
    if (routed.mode === "platform") return this.platform.complete(routed.request);
    return this.personal(routed.owner, routed.selection, routed.request);
  }
  async completeViaStream(
    request: LLMCompletionRequest,
    options: LLMCompleteViaStreamOptions = {},
  ): Promise<LLMCompletionResult> {
    const routed = this.route(request);
    if (routed.mode === "platform")
      return this.platform.completeViaStream
        ? this.platform.completeViaStream(routed.request, options)
        : this.platform.complete(routed.request);
    const owner = routed.owner,
      selection = routed.selection;
    // A personal failure never falls back to the platform model: the user picked
    // this endpoint and is billed by it, so silently switching would double-charge.
    return this.perform(
      routed.request,
      () => this.settings.credentials(owner, selection),
      () => this.settings.assertCurrent(owner, selection),
      {
        stream: true,
        transport: this.streamTransport,
        onContentDelta: options.onContentDelta,
      },
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
      { ...BUFFERED, transport: this.transport },
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
      { ...BUFFERED, transport: this.transport },
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
    mode: PersonalMode,
  ): Promise<LLMCompletionResult> {
    const controller = new AbortController(),
      signal = request.signal
        ? AbortSignal.any([request.signal, controller.signal])
        : controller.signal;
    const startedAt = this.now().getTime();
    let modelName = "personal";
    const timer = setTimeout(
      () => controller.abort(),
      Math.min(90000, Math.max(1, typeof request.providerOptions?.zookLightTickTimeoutMs === "number" ? request.providerOptions.zookLightTickTimeoutMs : this.timeoutMs)),
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
          modelName = cfg.model_name;
          signal.throwIfAborted();
          const response = await mode.transport(
            cfg.base_url + "/chat/completions",
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Accept: mode.stream ? "text/event-stream" : "application/json",
                Authorization: "Bearer " + cfg.api_key,
              },
              body: JSON.stringify({
                model: cfg.model_name,
                messages: request.messages,
                max_tokens: Math.min(request.maxTokens ?? 8192, 8192),
                temperature: request.temperature ?? 0.2,
                stream: mode.stream,
                // 标准网关支持 stream_options 时要在流末尾回 usage，否则 token 记账只能写 missing。
                ...(mode.stream && /dashscope|aliyuncs|bailian/i.test(cfg.base_url)
                  ? { stream_options: { include_usage: true } }
                  : {}),
                ...dashscopeThinkingOptions(cfg.base_url, cfg.model_name, request.providerOptions),
                ...personalThinkingOptions(cfg.base_url, request.providerOptions),
                ...(request.providerOptions?.response_format
                  ? { response_format: request.providerOptions.response_format }
                  : {}),
              }),
            },
            signal,
          );
          if (!response.ok) throw Error("MODEL_RESPONSE_FAILED_HTTP_" + response.status);
          // Gateways that ignore `stream: true` answer with one buffered JSON body.
          const streamed =
            mode.stream &&
            /^text\/event-stream(?:;|$)/i.test(
              String(response.headers.get("content-type") ?? ""),
            );
          if (streamed) {
            const chunked = await readPersonalModelStream(response, {
              onContentDelta: mode.onContentDelta,
            });
            signal.throwIfAborted();
            if (
              chunked.finishReason !== "stop" ||
              !chunked.text.trim()
            )
              throw Error("MODEL_RESPONSE_INCOMPLETE");
            const value: LLMCompletionResult = {
              provider: "personal",
              modelKey: "lighttick.personal",
              providerModel: cfg.model_name,
              text: chunked.text,
              finishReason: "stop",
              usage: chunked.usage ?? parseOpenAICompatibleChatUsage(undefined, "personal"),
            };
            await check();
            return value;
          }
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
      await this.observe(mode.stream === true, modelName, startedAt, "success", result.usage);
      return result;
    } catch (error) {
      const outcome: LlmCallOutcome =
        error instanceof ApplicationError && error.statusCode === 504 ? "timeout" : "failure";
      await this.observe(mode.stream === true, modelName, startedAt, outcome, undefined,
        error instanceof ApplicationError ? error.code : "LLM_PROVIDER_REQUEST_FAILED");
      if (error instanceof Error && /_HTTP_(401|403)$/.test(error.message)) throw new ApplicationError(502, "LLM_PROVIDER_REQUEST_FAILED", "模型服务拒绝授权，请在模型与设置中更新配置并重新测试。", {provider_status:Number(error.message.slice(-3))});
      if (error instanceof Error && /^MODEL_[A-Z_0-9]+$/.test(error.message)) console.warn("[lighttick-personal-model]", error.message);
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
  private async observe(
    stream: boolean,
    modelName: string,
    startedAt: number,
    outcome: LlmCallOutcome,
    usage?: LLMCompletionResult["usage"],
    errorCode?: string,
  ): Promise<void> {
    if (!this.observations) return;
    try {
      await this.observations.recordObservation({
        callId: `personal_${randomUUID()}`,
        occurredAt: new Date(startedAt).toISOString(),
        appId: "lighttick",
        routingModelKey: "lighttick.personal",
        provider: "personal",
        providerModel: modelName,
        operation: "chat",
        responseMode: (stream ? "stream" : "non_stream") as LlmResponseMode,
        outcome,
        healthImpact: outcome === "success" ? "success" : "failure",
        totalLatencyMs: Math.max(0, this.now().getTime() - startedAt),
        ...(usage ? {
          promptTokens: usage.promptTokens, completionTokens: usage.completionTokens,
          reasoningTokens: usage.reasoningTokens, totalTokens: usage.totalTokens,
        } : {}),
        usageSource: usage ? (usage.estimated ? "estimated" : "provider") : "missing",
        ...(errorCode ? { errorCode } : {}),
      });
    } catch {
      // 观测写入失败不得影响生成结果，也不掩盖原始错误。
    }
  }
}
