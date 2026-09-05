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
export const AINOVEL_E2E_STREAM_DELAY_MS_ENV = "AINOVEL_E2E_STREAM_DELAY_MS";
export const AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV =
  "AINOVEL_E2E_KICKOFF_ASK_FIRST";

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
    const submitToolNames = submitToolNamesFromProviderOptions(
      request.providerOptions,
    );
    if (submitToolNames.length > 0) {
      return this.completionWithToolCalls(request, submitToolNames);
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
      if (shouldAskKickoffQuestionFirst(request.messages)) {
        yield this.reasoningDelta(
          "本地 E2E 推理：先提出一个 kickoff 选项问题，等待用户选择后继续。",
        );
        yield {
          type: "content_delta",
          text: "先确认第一阶段的开局压力。",
        };
        yield {
          type: "tool_call",
          toolCall: this.toolCall("ask_question", kickoffAskQuestionPayload()),
        };
        yield this.usage();
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      yield this.reasoningDelta(
        "本地 E2E 推理：整理 kickoff 元数据并确认首章规划入口。",
      );
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

    const submitToolNames = submitToolNamesFromProviderOptions(
      request.providerOptions,
    );
    if (submitToolNames.length > 0) {
      yield this.reasoningDelta(
        `本地 E2E 推理：读取上下文后提交 ${submitToolNames.join(", ")} 结构化结果。`,
      );
      for (const toolName of submitToolNames) {
        const payload = forcedStructuredToolPayload(toolName, request);
        yield* this.toolArgumentDeltas(toolName, payload);
        yield {
          type: "tool_call",
          toolCall: this.toolCall(toolName, payload),
        };
      }
      yield this.usage();
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    if (
      toolNames.includes("read") &&
      /(?:使用|use)\s*chapter-continuity-review/i.test(
        [...request.messages]
          .reverse()
          .find((message) => message.role === "user")?.content ?? "",
      )
    ) {
      const toolMessages = request.messages.filter(
        (message) => message.role === "tool",
      );
      const hasSkill = toolMessages.some((message) =>
        message.content.includes('# Chapter continuity review'),
      );
      if (!hasSkill) {
        yield this.reasoningDelta(
          "本地 E2E 推理：先读取章节连续性检查 Skill 的完整说明。",
        );
        yield {
          type: "tool_call",
          toolCall: this.toolCall("read", {
            path: "/skills/ainovel/chapter-continuity-review/SKILL.md",
          }),
        };
        yield this.usage();
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      const hasWritingContext = toolMessages.some(
        (message) =>
          !message.toolCallId?.startsWith("autoctx_") &&
          message.content.includes('"kind":"writing_context"'),
      );
      if (!hasWritingContext && toolNames.includes("read_writing_context")) {
        yield this.reasoningDelta(
          "本地 E2E 推理：按照 Skill 读取当前章节与连续性上下文。",
        );
        yield {
          type: "tool_call",
          toolCall: this.toolCall("read_writing_context", {}),
        };
        yield this.usage();
        yield { type: "done", finishReason: "tool_calls" };
        return;
      }
      yield this.reasoningDelta(
        "本地 E2E 推理：依据 Skill 与当前章节上下文完成只读检查。",
      );
      yield {
        type: "content_delta",
        text: "连续性检查完成：当前上下文中未发现明确冲突；未核实的远端历史应再通过搜索确认。",
      };
      yield this.usage();
      yield { type: "done", finishReason: "stop" };
      return;
    }

    if (toolNames.includes("write_draft")) {
      if (!hasDraftToolRetryMessage(request.messages)) {
        yield this.reasoningDelta(
          "本地 E2E 推理：先输出一段普通草稿观察，等待代理要求写入章节工具。",
        );
        yield {
          type: "content_delta",
          text: "沈烬在边荒雪线里听见黑骨灯轻响，追兵的火把已经压到坡下。",
        };
        yield this.usage();
        yield { type: "done", finishReason: "stop" };
        return;
      }
      yield this.reasoningDelta(
        "本地 E2E 推理：结合上一轮工具结果和隐藏推理上下文生成章节草稿。",
      );
      const draftPayload = {
        title: "第一章 边荒残火",
        content: [
          "雨夜之后，沈烬被逐出山门，拖着断裂的灵脉跌进边荒。",
          "追杀者沿着血迹逼近时，师父留下的黑骨灯第一次亮起。",
          "灯中残魂只给了他一个选择：吞下失控灵火，活下来，再回去查清秘卷冤案。",
        ].join("\n\n"),
      };
      yield* this.toolArgumentDeltas("write_draft", draftPayload);
      yield {
        type: "tool_call",
        toolCall: this.toolCall("write_draft", draftPayload),
      };
      yield this.usage();
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }

    const text = this.defaultText(request);
    yield this.reasoningDelta("本地 E2E 推理：生成普通文本回复。");
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

  private completionWithToolCalls(
    request: ResolvedLLMCompletionRequest,
    toolNames: string[],
  ): LLMCompletionResult {
    return {
      provider: request.model.provider,
      modelKey: request.model.modelKey,
      providerModel: request.model.providerModel,
      text: "",
      toolCalls: toolNames.map((toolName) =>
        this.toolCall(toolName, forcedStructuredToolPayload(toolName, request)),
      ),
      finishReason: "tool_calls",
      providerRequestId: "local-e2e-tool",
    };
  }

  private async *toolArgumentDeltas(
    toolName: string,
    payload: Record<string, unknown>,
  ): AsyncIterable<LLMStreamEvent> {
    const streamDelayMs = localE2eStreamDelayMs();
    const progressSpec = toolProgressSpec(toolName);
    const toolArgumentPath = progressSpec?.path;
    const readableValue = toolArgumentPath ? payload[toolArgumentPath] : null;
    if (progressSpec?.known === true && !toolArgumentPath) {
      return;
    }
    const text =
      typeof readableValue === "string"
        ? readableValue
        : JSON.stringify(payload);
    const size = Math.max(24, Math.ceil(text.length / 3));
    for (let offset = 0; offset < text.length; offset += size) {
      yield {
        type: "tool_call_delta",
        text: text.slice(offset, offset + size),
        toolCallId: `local-${toolName}`,
        toolCallName: toolName,
        toolArgumentPath,
      };
      await new Promise((resolve) => setTimeout(resolve, streamDelayMs));
    }
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

  private reasoningDelta(text: string): LLMStreamEvent {
    return {
      type: "reasoning_delta",
      text,
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

function hasDraftToolRetryMessage(
  messages: ResolvedLLMCompletionRequest["messages"],
): boolean {
  return messages.some(
    (message) =>
      message.role === "user" &&
      message.content.includes(
        "The previous assistant turn did not call write_draft",
      ),
  );
}

function shouldAskKickoffQuestionFirst(
  messages: ResolvedLLMCompletionRequest["messages"],
): boolean {
  if (!isTruthy(process.env[AINOVEL_E2E_KICKOFF_ASK_FIRST_ENV])) {
    return false;
  }
  return !messages.some((message) => message.role === "tool");
}

function isTruthy(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(
    String(value ?? "")
      .trim()
      .toLowerCase(),
  );
}

function localE2eStreamDelayMs(env = process.env): number {
  const parsed = Number.parseInt(
    String(env[AINOVEL_E2E_STREAM_DELAY_MS_ENV] ?? ""),
    10,
  );
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 20;
  }
  return Math.min(parsed, 2000);
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

function submitToolNamesFromProviderOptions(
  providerOptions: Record<string, unknown> | undefined,
): string[] {
  return toolNamesFromProviderOptions(providerOptions).filter((name) =>
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

function kickoffAskQuestionPayload(): Record<string, unknown> {
  return {
    question: "第一阶段更想突出哪种开局压力？",
    options: [
      {
        label: "追兵压迫",
        subtitle: "从边荒追杀和濒死求生切入。",
      },
      {
        label: "残魂交易",
        subtitle: "从黑骨灯传承的代价切入。",
      },
    ],
    allowCustom: true,
  };
}

function forcedStructuredToolPayload(
  toolName: string,
  request?: ResolvedLLMCompletionRequest,
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
  if (toolName === "submit_import_plan_update") {
    const importRange = importChapterRangeFromRequest(request);
    const targetChapterIndex = importRange.latestImportedChapterIndex + 1;
    return {
      bookContract: {
        revisionId: "local-import-contract",
        storyPromise: "仅依据导入正文延续忠奸对抗与群像命运。",
        storyAnchors: [
          {
            label: "导入主角群",
            role: "source-grounded imported cast",
            rules: ["后续续写不得重写已经导入的关键结局。"],
          },
        ],
        focalization: "沿用导入正文的群像视角。",
        startState: `已导入第 ${importRange.latestImportedChapterIndex} 章，续写从第 ${targetChapterIndex} 章开始。`,
        trigger: "最新导入章节后的新压力出现。",
        drive: {
          mode: "continue_imported_story",
          object: "承接导入正文继续推进下一卷压力。",
        },
        pressureSources: ["导入章节留下的未解压力"],
        stakes: {
          external: "外部冲突继续扩大。",
          relational: "人物关系不能被重置。",
          internal: "人物动机承接导入章节。",
        },
        worldConstraints: ["不得凭空推翻已导入事实。"],
        changeHorizon: "规划接下来十章的续写推进。",
        scale: {
          length: { preset: "long", note: "导入长篇续写" },
          chapterLength: {
            preset: "standard",
            minChars: 2500,
            maxChars: 4500,
            note: "本地验证章节长度",
          },
          pov: { preset: "ensemble_pov", note: "沿用群像" },
          threadDensity: {
            preset: "main_with_subthreads",
            note: "主线带支线",
          },
          pace: { preset: "moderate", note: "平稳推进" },
        },
        language: "zh-Hans",
        toneRegister: "原书气口",
        extras: {},
        readiness: 0.82,
      },
      mainLine: {
        revisionId: "local-import-mainline",
        title: "导入后的续写入口",
        summary: "本地导入流程已整理已读正文，并准备从最新章节之后继续。",
        arcPromise: "后续只推进导入正文之后的新压力。",
        arcRules: ["不得凭空推翻已导入事实。"],
        startChapterIndex: targetChapterIndex,
        endChapterIndex: targetChapterIndex + 9,
        beats: Array.from({ length: 10 }, (_, index) => {
          const chapterIndex = targetChapterIndex + index;
          return {
            id: `local-import-chapter-${chapterIndex}`,
            chapterIndex,
            goal:
              chapterIndex === targetChapterIndex
                ? "承接最新导入章节后的余波。"
                : `推进第 ${chapterIndex} 章续写压力。`,
            mustCover: ["交代当前人物状态"],
            forbidden: ["重写已导入结局"],
            change: "建立并推进新的续写压力。",
            endBoundary: "停在新压力继续扩大的节点。",
            endingOpenQuestion: "新压力会把人物推向何处？",
          };
        }),
      },
      importEvidence: {
        latestImportedChapterIndex: importRange.latestImportedChapterIndex,
        targetChapterIndex,
        sourceCoverage: {
          importedRanges: [`1..${importRange.latestImportedChapterIndex}`],
          currentRange: `${importRange.startChapterIndex}..${importRange.endChapterIndex}`,
          finalHotRange: `${Math.max(1, importRange.latestImportedChapterIndex - 2)}..${importRange.latestImportedChapterIndex}`,
        },
        refsByArtifactPath: {
          "/bookContract/storyPromise": [
            {
              id: "local-import-evidence-1",
              chapterIndex: importRange.latestImportedChapterIndex,
              title: `第 ${importRange.latestImportedChapterIndex} 章`,
              snippet: `第 ${importRange.latestImportedChapterIndex} 章以前的导入正文提供续写边界。`,
              sourceHash: `local-import-chapter-${importRange.latestImportedChapterIndex}`,
            },
          ],
          "/mainLine/summary": [
            {
              id: "local-import-evidence-2",
              chapterIndex: importRange.latestImportedChapterIndex,
              title: `第 ${importRange.latestImportedChapterIndex} 章`,
              snippet: "续写从最新章节之后继续。",
              sourceHash: `local-import-chapter-${importRange.latestImportedChapterIndex}`,
            },
          ],
        },
        uncertainClaims: [],
        forbiddenRetcons: ["不得重写已导入结局"],
        resolvedThreads: [],
        activeThreads: ["新续写压力尚未展开"],
        styleSignals: ["延续原书气口"],
      },
      changedFields: ["/bookContract/storyPromise", "/mainLine/summary"],
      conflictNotes: [],
      uncertaintyNotes: [],
    };
  }
  if (toolName === "submit_rolling_snapshot") {
    const importRange = importChapterRangeFromRequest(request);
    return {
      snapshot:
        "本地导入正文已建立核心冲突、人物状态和续写边界；后续只能在最新已导入章节之后推进。",
      evidence: [
        `local imported chapters ${importRange.startChapterIndex}..${importRange.endChapterIndex}`,
      ],
      sourceRange: {
        startChapterIndex: importRange.startChapterIndex,
        endChapterIndex: importRange.endChapterIndex,
      },
    };
  }
  if (toolName === "submit_chapter_summaries") {
    const importRange = importChapterRangeFromRequest(request);
    return {
      summaries: chapterIndexes(importRange).map((chapterIndex) => ({
        chapterIndex,
        title: `第 ${chapterIndex} 章`,
        summary: `第 ${chapterIndex} 章延续导入正文的人物关系、冲突压力和续写边界。`,
        facts: {
          characters: ["导入主角群"],
          stakes: ["续写不能改写已导入事实"],
        },
        evidence: [`local imported chapter ${chapterIndex}`],
      })),
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
      brief: "本章继续推进边荒追杀压力，强化黑骨灯反噬代价。",
      required: { chapterGoal: "推进边荒追杀压力" },
      strategy: { mustCover: ["追兵压迫", "残魂反噬"] },
      contextRefs: {},
    };
  }
  if (toolName === "submit_hot_handoff") {
    const importRange = importChapterRangeFromRequest(request);
    const targetChapterIndex = importRange.latestImportedChapterIndex + 1;
    return {
      targetChapterIndex,
      handoff: "从最新导入章节之后继续，保留已导入人物状态和未解决压力。",
      unresolvedThreads: ["新续写压力尚未展开"],
      characterStates: ["导入主角群：保持最新导入章节后的状态"],
      styleSignals: ["延续原书气口"],
      evidence: [
        `local imported chapter ${importRange.latestImportedChapterIndex}`,
      ],
    };
  }
  return { ok: true };
}

interface ImportChapterRange {
  startChapterIndex: number;
  endChapterIndex: number;
  latestImportedChapterIndex: number;
}

function importChapterRangeFromRequest(
  request: ResolvedLLMCompletionRequest | undefined,
): ImportChapterRange {
  const text = latestUserContent(request);
  const explicitRange = lastExplicitChapterRange(text);
  if (explicitRange) {
    return explicitRange;
  }

  const indexes = Array.from(
    text.matchAll(/"(?:chapterIndex|index|originalIndex)"\s*:\s*(\d+)/g),
    (match) => Number.parseInt(match[1] ?? "", 10),
  ).filter((value) => Number.isInteger(value) && value > 0);
  if (indexes.length > 0) {
    const start = Math.min(...indexes);
    const end = Math.max(...indexes);
    return {
      startChapterIndex: start,
      endChapterIndex: end,
      latestImportedChapterIndex: end,
    };
  }

  return {
    startChapterIndex: 1,
    endChapterIndex: 1,
    latestImportedChapterIndex: 1,
  };
}

function latestUserContent(
  request: ResolvedLLMCompletionRequest | undefined,
): string {
  const latestUser = [...(request?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  return latestUser?.content ?? "";
}

function lastExplicitChapterRange(
  text: string,
): ImportChapterRange | undefined {
  const ranges = Array.from(
    text.matchAll(/chapters?\s+(\d+)\s*(?:\.\.|-|to|至|到)\s*(\d+)/gi),
  );
  const last = ranges.at(-1);
  if (!last) {
    return undefined;
  }
  const left = Number.parseInt(last[1] ?? "", 10);
  const right = Number.parseInt(last[2] ?? "", 10);
  if (
    !Number.isInteger(left) ||
    !Number.isInteger(right) ||
    left <= 0 ||
    right <= 0
  ) {
    return undefined;
  }
  const start = Math.min(left, right);
  const end = Math.max(left, right);
  return {
    startChapterIndex: start,
    endChapterIndex: end,
    latestImportedChapterIndex: end,
  };
}

function chapterIndexes(range: ImportChapterRange): number[] {
  return Array.from(
    {
      length: range.endChapterIndex - range.startChapterIndex + 1,
    },
    (_, index) => range.startChapterIndex + index,
  );
}

function toolProgressSpec(
  toolName: string | undefined,
): { known: true; path?: string } | undefined {
  switch (toolName) {
    case "write_draft":
      return { known: true, path: "content" };
    case "submit_next_chapter_brief":
      return { known: true, path: "brief" };
    case "submit_chapter_summary":
      return { known: true, path: "summary" };
    case "submit_chapter_review":
      return { known: true, path: "summary" };
    case "submit_snapshot":
    case "submit_rolling_snapshot":
      return { known: true, path: "snapshot" };
    case "submit_hot_handoff":
      return { known: true, path: "handoff" };
    case "submit_import_plan_update":
    case "submit_chapter_summaries":
    case "read":
    case "read_writing_context":
      return { known: true };
    default:
      return undefined;
  }
}
