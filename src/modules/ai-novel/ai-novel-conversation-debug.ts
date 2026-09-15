import type {
  AiNovelConversationTool,
} from "../../shared/types/ai-novel-conversation.ts";
import type { LLMMessage } from "../../services/llm-manager.ts";

export interface AiNovelConversationDebugMetadata {
  systemPrompt?: string;
  tools: AiNovelConversationTool[];
}

export function buildAiNovelConversationDebugMetadata(input: {
  messages: LLMMessage[];
  providerOptions?: Record<string, unknown>;
}): AiNovelConversationDebugMetadata {
  const systemPrompt = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content?.trim() ?? "")
    .filter(Boolean)
    .join("\n\n");
  return {
    ...(systemPrompt ? { systemPrompt } : {}),
    tools: readConversationTools(input.providerOptions?.tools),
  };
}

function readConversationTools(value: unknown): AiNovelConversationTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const functionRecord = (item as Record<string, unknown>).function;
    if (!functionRecord || typeof functionRecord !== "object" || Array.isArray(functionRecord)) {
      return [];
    }
    const record = functionRecord as Record<string, unknown>;
    if (typeof record.name !== "string" || !record.name.trim()) return [];
    const parameters = record.parameters;
    return [{
      name: record.name.trim(),
      description: typeof record.description === "string" ? record.description : "",
      inputSchema: parameters && typeof parameters === "object" && !Array.isArray(parameters)
        ? parameters as Record<string, unknown>
        : {},
    }];
  });
}
