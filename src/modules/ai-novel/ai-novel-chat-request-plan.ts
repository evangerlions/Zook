import type {
  LLMMessage,
  LLMToolDefinition,
} from "../../services/llm-manager.ts";
import type { AccountRegion } from "../../shared/types.ts";
import {
  buildKickoffMessages,
  normalizeKickoffMetaContext,
} from "./ai-novel-kickoff-context.ts";
import { kickoffToolDefinitions } from "./ai-novel-kickoff-tools.ts";
import {
  buildAiNovelPromptAssembly,
  filterAiNovelAgentTools,
  toOpenAiToolDefinitions,
} from "./ai-novel-llm-prompts.ts";
import type { AiNovelAgentProtocol } from "./ai-novel-llm-request-validation.ts";
import type { AiNovelChatScene } from "./ai-novel-llm-scenes.ts";
import type { AiNovelPromptProfile } from "./prompts/ai-novel-prompt-types.ts";
import { applyAiNovelRegionSystemPrompt } from "./ai-novel-region-system-prompt.ts";

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
  accountRegion?: AccountRegion;
  agentProtocol?: AiNovelAgentProtocol;
  context: unknown;
  locale?: string;
  messages: LLMMessage[];
  scene: AiNovelChatScene;
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
        Boolean(input.scene.completeViaStream) ||
          input.scene.profile === "import_book_agent",
      ),
    },
    input.accountRegion,
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
              input.context,
              input.agentProtocol,
            ),
          ),
          tool_choice: "auto",
        },
      },
      input.accountRegion,
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
    );
  }
  if (input.scene.profile) {
    return finalizeAiNovelRequestPlan(
      {
        adapter: "prompted",
        messages: assembly.messages,
        profile: input.scene.profile,
        ...optionalProviderOptions(input.scene.profile, assembly.tools, true),
      },
      input.accountRegion,
    );
  }
  return finalizeAiNovelRequestPlan(
    { adapter: "basic", messages: assembly.messages },
    input.accountRegion,
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
      })
    : { messages: input.messages, tools: [] as LLMToolDefinition[] };
}

function optionalProviderOptions(
  profile: AiNovelPromptProfile | undefined,
  tools: LLMToolDefinition[],
  enableThinking: boolean,
): { providerOptions?: Record<string, unknown> } {
  if (!enableThinking && tools.length === 0) {
    return {};
  }
  return {
    providerOptions: {
      ...(enableThinking ? { enable_thinking: true } : {}),
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
): T {
  return {
    ...plan,
    messages: applyAiNovelRegionSystemPrompt(plan.messages, accountRegion),
  };
}
