import { webSearchTool } from "./tools/web-search-tool.ts";
import { SEARCH_SCENES } from "./search/search-types.ts";
import { assembleAiNovelSystemPrompt } from "./prompts/ai-novel-system-prompt-assembler.ts";
import type { LLMMessage } from "../../services/llm-manager.ts";
import type { AccountRegion } from "../../shared/types.ts";
import {
  buildKickoffMessages,
  normalizeKickoffMetaContext,
} from "./ai-novel-kickoff-context.ts";
import { kickoffToolDefinitions } from "./ai-novel-kickoff-tools.ts";
import {
  buildAiNovelPromptAssembly,
  toOpenAiToolDefinitions,
} from "./ai-novel-llm-prompts.ts";
import type { AiNovelAgentProtocol } from "./ai-novel-llm-request-validation.ts";
import type { AiNovelChatScene } from "./ai-novel-llm-scenes.ts";
import type { AiNovelPromptProfile } from "./prompts/ai-novel-prompt-types.ts";
import { applyAiNovelRegionSystemPrompt } from "./ai-novel-region-system-prompt.ts";
import type { AiNovelToolDefinition } from "./tools/ai-novel-tool-definition.ts";
import { filterAiNovelAgentTools } from "./tools/ai-novel-tool-visibility.ts";

const IMPORT_BOOK_STREAM_FIRST_EVENT_TIMEOUT_MS = 120_000;
const IMPORT_BOOK_STREAM_IDLE_TIMEOUT_MS = 90_000;

interface AiNovelRequestPlanBase {
  messages: LLMMessage[];
  profile?: AiNovelPromptProfile;
  providerOptions?: Record<string, unknown>;
}

export interface AiNovelCompletionRequestPlan extends AiNovelRequestPlanBase {
  forcedToolName?: string;
}

type PromptedStreamProfile = Exclude<
  AiNovelPromptProfile,
  "kickoff_turn_imported_book"
>;

export type AiNovelStreamRequestPlan =
  | (AiNovelRequestPlanBase & { adapter: "basic"; profile?: undefined })
  | (AiNovelRequestPlanBase & { adapter: "kickoff"; profile?: undefined })
  | (AiNovelRequestPlanBase & {
      adapter: "imported_kickoff";
      profile: "kickoff_turn_imported_book";
    })
  | (AiNovelRequestPlanBase & {
      adapter: "prompted";
      profile: PromptedStreamProfile;
    });

interface BuildAiNovelRequestPlanInput {
  webSearchEnabled?: boolean;
  accountRegion?: AccountRegion;
  agentProtocol?: AiNovelAgentProtocol;
  context: unknown;
  locale?: string;
  messages: LLMMessage[];
  scene: AiNovelChatScene;
  chapterThinking?: boolean;
  appVersion?: string;
}

export function buildAiNovelCompletionRequestPlan(
  input: BuildAiNovelRequestPlanInput,
): AiNovelCompletionRequestPlan {
  const assembly = buildScenePromptAssembly(input);
  return finalizeAiNovelRequestPlan(
    {
      messages: assembly.messages,
      ...(input.scene.profile ? { profile: input.scene.profile } : {}),
      ...(assembly.forcedToolName
        ? { forcedToolName: assembly.forcedToolName }
        : {}),
      ...optionalProviderOptions(
        input.scene.profile,
        assembly.tools,
        input.scene.profile === "import_chapter_segmentation"
          ? input.chapterThinking === true
          : Boolean(input.scene.completeViaStream) || input.scene.profile === "import_book_agent",
      ),
    },
    input.accountRegion,
      input,
  );
}

export function buildAiNovelStreamRequestPlan(
  input: BuildAiNovelRequestPlanInput,
): AiNovelStreamRequestPlan {
  if (input.scene.sceneKey === "kickoff_turn") {
    return finalizeAiNovelRequestPlan(
      {
        adapter: "kickoff",
        messages: buildKickoffMessages(
          input.messages,
          input.agentProtocol === "pi-v1"
            ? undefined
            : normalizeKickoffMetaContext(input.context),
          input.locale,
        ),
        providerOptions: {
          enable_thinking: true,
          tools: toOpenAiToolDefinitions(
            filterAiNovelAgentTools(
              kickoffToolDefinitions,
              input,
            ),
          ),
          tool_choice: "auto",
        },
      },
      input.accountRegion,
      input,
    );
  }

  const assembly = buildScenePromptAssembly(input);
  if (input.scene.profile === "kickoff_turn_imported_book") {
    return finalizeAiNovelRequestPlan(
      {
        adapter: "imported_kickoff",
        messages: assembly.messages,
        profile: input.scene.profile,
        ...optionalProviderOptions(input.scene.profile, assembly.tools, true),
      },
      input.accountRegion,
      input,
    );
  }
  if (input.scene.profile) {
    return finalizeAiNovelRequestPlan(
      {
        adapter: "prompted",
        messages: assembly.messages,
        profile: input.scene.profile,
        ...optionalProviderOptions(input.scene.profile, assembly.tools, input.scene.profile === "import_chapter_segmentation" ? input.chapterThinking === true : true),
      },
      input.accountRegion,
      input,
    );
  }
  return finalizeAiNovelRequestPlan(
    { adapter: "basic", messages: assembly.messages },
    input.accountRegion,
      input,
  );
}

function buildScenePromptAssembly(input: BuildAiNovelRequestPlanInput) {
  return input.scene.profile
    ? buildAiNovelPromptAssembly({
        profile: input.scene.profile,
        messages: input.messages,
        context: input.context,
        agentProtocol: input.agentProtocol,
        locale: input.locale,
        appVersion: input.appVersion,
      })
    : { messages: input.messages, tools: [] as AiNovelToolDefinition[] };
}

function optionalProviderOptions(
  profile: AiNovelPromptProfile | undefined,
  tools: AiNovelToolDefinition[],
  enableThinking: boolean,
): { providerOptions?: Record<string, unknown> } {
  if (!enableThinking && tools.length === 0 && profile !== "import_chapter_segmentation") {
    return {};
  }
  return {
    providerOptions: {
      ...(profile === "import_chapter_segmentation" ? { zookLogBodyMode: "suppress" } : {}),
      ...(enableThinking ? { enable_thinking: true } : profile === "import_chapter_segmentation" ? { enable_thinking: false } : {}),
      ...(tools.length > 0
        ? {
            tools: toOpenAiToolDefinitions(tools),
            tool_choice: "auto",
          }
        : {}),
      ...(profile === "import_book_agent"
        ? {
            stream_options: {
              first_event_timeout_ms: IMPORT_BOOK_STREAM_FIRST_EVENT_TIMEOUT_MS,
              idle_timeout_ms: IMPORT_BOOK_STREAM_IDLE_TIMEOUT_MS,
            },
          }
        : {}),
    },
  };
}

function finalizeAiNovelRequestPlan<T extends AiNovelRequestPlanBase>(
  plan: T,
  accountRegion: AccountRegion | undefined,
  input: BuildAiNovelRequestPlanInput,
): T {
  const search = input.webSearchEnabled && SEARCH_SCENES.includes(input.scene.sceneKey as typeof SEARCH_SCENES[number])
    ? filterAiNovelAgentTools([webSearchTool], input) : [];
  if (search.length) {
    plan = { ...plan, providerOptions: { ...plan.providerOptions, tools: [...(plan.providerOptions?.tools as unknown[] ?? []), ...toOpenAiToolDefinitions(search)] } };
  }
  return {
    ...plan,
    messages: applyAiNovelRegionSystemPrompt(assembleAiNovelSystemPrompt(plan.messages, {
      sceneKey: input.scene.sceneKey,
      appVersion: input.appVersion,
      agentProtocol: input.agentProtocol,
      availableTools: (plan.providerOptions?.tools as Array<{ function: { name: string } }> | undefined)?.map(tool => tool.function.name) ?? [],
    }), accountRegion),
  };
}
