import type {
  EmbeddingProvider,
  EmbeddingResult,
  ResolvedEmbeddingRequest,
} from "./embedding-manager.ts";
import type {
  LLMCompletionResult,
  LLMProvider,
  LLMStreamEvent,
  ResolvedLLMCompletionRequest,
  LLMToolCall,
} from "./llm-manager.ts";

export const AINOVEL_E2E_LLM_PROVIDER_ENV = "AINOVEL_E2E_LLM_PROVIDER";

export function shouldUseLocalAiNovelE2eProvider(env = process.env): boolean {
  if (!isTruthy(env[AINOVEL_E2E_LLM_PROVIDER_ENV])) {
    return false;
  }
  return isLocalRuntime(env);
}

export class LocalAiNovelE2eProvider implements LLMProvider, EmbeddingProvider {
  async complete(
    request: ResolvedLLMCompletionRequest,
  ): Promise<LLMCompletionResult> {
    const toolName = firstSubmitToolName(request.providerOptions);
    if (toolName) {
      return this.completionWithToolCall(request, toolName);
    }

    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text: this.defaultText(request),
      finishReason: "stop",
      providerRequestId: "local-e2e-complete",
    };
  }

  async *stream(
    request: ResolvedLLMCompletionRequest,
  ): AsyncIterable<LLMStreamEvent> {
    const toolNames = toolNamesFromProviderOptions(request.providerOptions);
    if (isKickoffToolSet(toolNames)) {
      yield {
        type: "content_delta",
        text: "这个方向已经可以开书了，我先把开局合同整理好。",
      };
      yield {
        type: "tool_call",
        toolCall: this.toolCall("update_meta", kickoffMetaPayload()),
      };
      yield {
        type: "tool_call",
        toolCall: this.toolCall("ready", kickoffReadyPayload()),
      };
      yield this.usage();
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const toolName = firstSubmitToolName(request.providerOptions);
    if (toolName) {
      yield {
        type: "tool_call",
        toolCall: this.toolCall(
          toolName,
          forcedStructuredToolPayload(toolName),
        ),
      };
      yield this.usage();
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    if (toolNames.includes("write_draft")) {
      yield {
        type: "tool_call",
        toolCall: this.toolCall("write_draft", {
          title: "第一章 边荒残火",
          content: [
            "雨夜之后，沈烬被逐出山门，拖着断裂的灵脉跌进边荒。",
            "追杀者沿着血迹逼近时，师父留下的黑骨灯第一次亮起。",
            "灯中残魂只给了他一个选择：吞下失控灵火，活下来，再回去查清秘卷冤案。",
          ].join("\n\n"),
        }),
      };
      yield this.usage();
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const text = this.defaultText(request);
    yield { type: "content_delta", text };
    yield this.usage();
    yield { type: "done", finishReason: "stop" };
  }

  async embed(request: ResolvedEmbeddingRequest): Promise<EmbeddingResult> {
    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      providerRequestId: "local-e2e-embed",
      vectors: request.input.map((_, index) => ({
        index,
        embedding: [0.01 + index, 0.02 + index, 0.03 + index],
      })),
      usage: {
        promptTokens: request.input.join("").length,
        completionTokens: 0,
        totalTokens: request.input.join("").length,
      },
    };
  }

  private completionWithToolCall(
    request: ResolvedLLMCompletionRequest,
    toolName: string,
  ): LLMCompletionResult {
    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text: "",
      toolCalls: [
        this.toolCall(toolName, forcedStructuredToolPayload(toolName)),
      ],
      finishReason: "tool_calls",
      providerRequestId: "local-e2e-tool",
    };
  }

  private toolCall(name: string, input: Record<string, unknown>): LLMToolCall {
    return {
      id: `local_e2e_${name}`,
      name,
      input,
    };
  }

  private usage(): LLMStreamEvent {
    return {
      type: "usage",
      usage: {
        promptTokens: 128,
        completionTokens: 96,
        totalTokens: 224,
      },
    };
  }

  private defaultText(request: ResolvedLLMCompletionRequest): string {
    const latestUser = [...request.messages]
      .reverse()
      .find((message) => message.role === "user")?.content;
    if (latestUser?.trim()) {
      return "收到，我会按这个方向继续推进。";
    }
    return "本地 E2E 已生成稳定响应。";
  }
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function isLocalRuntime(env: NodeJS.ProcessEnv): boolean {
  const appEnv = String(env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  const nodeEnv = String(env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  if (appEnv === "online" || appEnv === "production" || appEnv === "prod") {
    return false;
  }
  return (
    appEnv === "local" ||
    appEnv === "dev" ||
    appEnv === "development" ||
    nodeEnv === "development" ||
    nodeEnv === "test"
  );
}

function toolNamesFromProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
): string[] {
  return (
    (providerOptions?.tools as Array<Record<string, unknown>> | undefined) ?? []
  ).map((tool) =>
    String((tool.function as Record<string, unknown> | undefined)?.name ?? ""),
  );
}

function isKickoffToolSet(toolNames: string[]): boolean {
  return (
    toolNames.includes("update_meta") &&
    toolNames.includes("ready") &&
    toolNames.includes("ask_question")
  );
}

function firstSubmitToolName(
  providerOptions: Record<string, unknown> | undefined,
): string | undefined {
  return toolNamesFromProviderOptions(providerOptions).find((name) =>
    name.startsWith("submit_"),
  );
}

function kickoffMetaPayload(): Record<string, unknown> {
  return {
    titleCandidate: "烬骨长明",
    readiness: 1,
    storyPromise:
      "一部被逐出宗门的少年在边荒死局中唤醒残魂传承、反杀追兵并查清秘卷冤案的东方玄幻长篇。",
    storyAnchors: [
      {
        label: "沈烬",
        name: "沈烬",
        role: "单主角",
        rules: [
          "被同门和长老栽赃偷窃镇宗秘卷后逐出山门。",
          "靠师父遗物中的上古残魂传承在边荒求生。",
        ],
      },
      {
        label: "上古残魂传承",
        role: "核心金手指",
        rules: [
          "可以吞噬灵火与残魂成长。",
          "每次吞噬都会带来反噬和身份暴露风险。",
        ],
      },
    ],
    focalization: "贴近沈烬的单主角视角，保留宗门高层阴谋信息差。",
    startState: "沈烬被逐出山门后重伤流落边荒，追兵正在逼近。",
    trigger: "师父遗物黑骨灯在濒死时亮起，上古残魂要求他吞下失控灵火。",
    drive: {
      mode: "survive_and_reclaim",
      object: "活过边荒追杀，洗清秘卷冤屈并夺回师父一脉传承。",
    },
    pressureSources: ["宗门追杀", "边荒妖火", "残魂反噬", "秘卷禁地阴谋"],
    stakes: {
      external: "上古禁地被宗门高层打开后会吞噬边荒和宗门秩序。",
      relational: "师父一脉名声与旧友信任会被彻底抹黑。",
      internal: "沈烬必须在复仇和被残魂力量吞噬之间守住自我。",
    },
    worldConstraints: [
      "灵火可以炼体也会灼伤神魂。",
      "宗门秘卷与上古禁地钥匙相关。",
      "残魂传承不能无代价解决所有冲突。",
    ],
    changeHorizon:
      "从边荒濒死求生，到外围清算，再逐步揭开宗门高层借秘卷打开上古禁地的阴谋。",
    premiseScale: {
      length: { preset: "long", note: "四十到五十万字长篇。" },
      chapterLength: {
        preset: "standard",
        minChars: 2500,
        maxChars: 3500,
        note: "标准网文章节长度。",
      },
      pov: { preset: "single_pov", note: "沈烬单主角视角。" },
      threadDensity: {
        preset: "main_with_subthreads",
        note: "主线复仇翻案，辅以传承反噬和旧人关系。",
      },
      pace: { preset: "fast", note: "开场直接进入边荒求生和第一次反杀。" },
    },
    language: "Simplified Chinese",
    toneRegister: "热血、压迫感强、节奏快。",
    extras: {
      localE2e: true,
    },
  };
}

function kickoffReadyPayload(): Record<string, unknown> {
  return {
    summary:
      "《烬骨长明》是一部热血压迫感强的东方玄幻长篇：沈烬被宗门栽赃逐出后，在边荒濒死局中唤醒师父遗物里的上古残魂传承，以灵火反杀追兵，并一步步查清秘卷与上古禁地阴谋。",
    mainLine: {
      revisionId: "kickoff",
      title: "边荒残火",
      summary:
        "前六章让沈烬从逐出宗门后的濒死状态完成第一次反杀，并得到回头清算的线索。",
      arcPromise: "用边荒求生、残魂反噬和追兵压迫建立复仇翻案主线。",
      arcRules: [
        "不要提前洗清秘卷冤屈。",
        "残魂传承每次出手都要留下反噬代价。",
      ],
      startChapterIndex: 1,
      endChapterIndex: 6,
      beats: Array.from({ length: 6 }, (_, index) => {
        const chapterIndex = index + 1;
        return {
          id: `kickoff-beat-${chapterIndex}`,
          chapterIndex,
          goal: `推进沈烬边荒求生的第 ${chapterIndex} 个压力节点。`,
          mustCover:
            chapterIndex === 1
              ? ["重伤逃亡", "黑骨灯亮起", "追兵逼近"]
              : [`边荒压力升级 ${chapterIndex}`],
          forbidden: ["不要写到宗门高层真相揭开。"],
          change: `沈烬获得第 ${chapterIndex} 个反击或求生筹码。`,
          endBoundary: `停在第 ${chapterIndex} 个边荒节点完成，不进入后续宗门清算。`,
          endingOpenQuestion:
            chapterIndex === 6 ? "沈烬如何带着反噬回到宗门外围？" : "",
        };
      }),
    },
  };
}

function forcedStructuredToolPayload(
  toolName: string,
): Record<string, unknown> {
  if (toolName === "submit_content_safety_decision") {
    return {
      decision: "pass",
      category: "safe",
    };
  }
  if (toolName === "submit_chapter_summary") {
    return {
      summary: "沈烬在边荒残火中活下来，黑骨灯和残魂传承正式显露。",
      facts: {
        actualEvents: ["沈烬被追兵逼入边荒", "黑骨灯亮起"],
        unresolvedQuestions: ["残魂真实身份仍未揭开"],
      },
    };
  }
  if (toolName === "submit_chapter_review") {
    return {
      verdict: "pass",
      summary: "章节完成当前边荒求生节点。",
      issues: [],
      planned: ["边荒求生", "黑骨灯显露"],
      covered: ["边荒求生", "黑骨灯显露"],
      missed: [],
      extra: [],
    };
  }
  if (toolName === "submit_snapshot") {
    return {
      snapshot:
        "沈烬被逐出宗门后在边荒靠黑骨灯残魂传承活下，复仇翻案主线继续推进。",
    };
  }
  if (toolName === "submit_next_chapter_brief") {
    return {
      brief: "下一章继续推进边荒追杀压力，强化黑骨灯反噬代价。",
      required: { chapterGoal: "推进边荒追杀压力" },
      strategy: { mustCover: ["追兵压迫", "残魂反噬"] },
      contextRefs: {},
    };
  }
  return { ok: true };
}
