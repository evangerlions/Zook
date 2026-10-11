import { ApplicationError } from "../shared/errors.ts";
import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import type { LLMCompletionResult } from "./llm-manager.ts";
import { CONTENT_SAFETY_LLM_SYSTEM_PROMPT, CONTENT_SAFETY_DECISION_TOOL, CONTENT_SAFETY_DECISION_TOOL_NAME } from "./content-safety-llm-rules.ts";

export const JEV_MODERATION_MODEL = "typesafe/jev-1.13";
const CATEGORIES = CONTENT_SAFETY_DECISION_TOOL.function.parameters.properties.category.enum;

export function buildJevModerationBody(text: string) {
  const instructions = CONTENT_SAFETY_LLM_SYSTEM_PROMPT.replace(
    '你必须调用 submit_content_safety_decision function，且只提交以下字段：\n- decision: "pass" 或 "block"\n- category: 下方枚举之一',
    "请从给定的 category 选项中选择一个：safe 表示 pass，其余类别表示 block。只返回类型化分类结果。",
  );
  const criteria = Object.fromEntries(CATEGORIES.map(category => [
    category, category === "safe" ? "符合放行条件，且未命中任何阻断类别"
      : CONTENT_SAFETY_LLM_SYSTEM_PROMPT.split("\n").find(line => line.includes(category + "："))?.replace(/^\d+\. /, ""),
  ]));
  return { model: JEV_MODERATION_MODEL, state: text,
    questions: { moderation: { type: "choice", instructions, criteria } } };
}

export class JevContentSafetyClient {
  constructor(
    private readonly config: CommonLlmConfigService,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  async complete(text: string, timeoutMs: number): Promise<LLMCompletionResult> {
    const signal = AbortSignal.timeout(timeoutMs);
    const runtime = await this.config.getRuntimeConfig();
    signal.throwIfAborted();
    const provider = runtime?.providers.find(item => item.key === "openrouter");
    if (runtime && (!runtime.enabled || !provider?.enabled || !provider.apiKey)) {
      throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "OpenRouter provider is disabled or missing credentials.");
    }
    const apiKey = provider?.apiKey ?? process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY;
    if (!apiKey) throw new ApplicationError(503, "LLM_SERVICE_NOT_CONFIGURED", "OpenRouter credentials are not configured.");
    const baseUrl = provider?.baseUrl ?? "https://openrouter.ai/api/v1";
    const url = baseUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + "/alpha/decisions";
    const response = await this.fetchImplementation(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildJevModerationBody(text)), signal,
    });
    if (!response.ok) {
      // Do not include provider body: it may echo the private input.
      throw new ApplicationError(response.status, "LLM_PROVIDER_REQUEST_FAILED", `Jev decision request returned HTTP ${response.status}.`);
    }
    let payload: JevResponse;
    try {
      payload = await response.json() as JevResponse;
    } catch {
      throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", "Jev returned invalid JSON.");
    }
    if (!payload || typeof payload !== "object") {
      throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", "Jev returned an invalid response.");
    }
    const answer = payload.answers?.moderation;
    if (answer?.type !== "choice" || !CATEGORIES.includes(answer.choice ?? "")) {
      throw new ApplicationError(502, "LLM_PROVIDER_RESPONSE_INVALID", "Jev returned an invalid moderation category.");
    }
    const category = answer.choice as string;
    const promptTokens = tokenCount(payload.usage?.input_tokens);
    const completionTokens = tokenCount(payload.usage?.output_tokens);
    return {
      provider: "openrouter", modelKey: "jev-1.13",
      providerModel: typeof payload.model === "string" ? payload.model : JEV_MODERATION_MODEL,
      providerRequestId: typeof payload.id === "string" ? payload.id : undefined,
      text: "", finishReason: "stop",
      toolCalls: [{ id: "jev-moderation", name: CONTENT_SAFETY_DECISION_TOOL_NAME, input: {
        decision: category === "safe" ? "pass" : "block", category,
        confidence: answer.confidence, probabilities: answer.probabilities,
      } }],
      usage: { promptTokens, completionTokens, totalTokens: promptTokens + completionTokens },
    };
  }
}

interface JevResponse {
  id?: unknown;
  model?: unknown;
  answers?: { moderation?: { type?: string; choice?: string; confidence?: unknown; probabilities?: unknown } };
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}
