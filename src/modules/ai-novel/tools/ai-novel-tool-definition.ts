import type { LLMToolDefinition } from "../../../services/llm-manager.ts";
import { isAiNovelClientVersionAtLeast, parseAiNovelClientVersion } from "../ai-novel-client-version.ts";
import type { AiNovelAgentProtocol } from "../ai-novel-llm-request-validation.ts";

export interface AiNovelToolVisibility {
  /** Omit for existing tools that must continue to support unversioned clients. */
  minAppVersion?: string;
  /** Inclusive upper bound. Omit to leave the maximum version unrestricted. */
  maxAppVersion?: string;
  agentProtocol?: AiNovelAgentProtocol;
  requiresSkills?: boolean;
}

export interface AiNovelToolDefinition extends LLMToolDefinition {
  visibility: AiNovelToolVisibility;
}

/** Server-only compatibility metadata lives alongside the model-facing schema. */
export function defineAiNovelTool(tool: AiNovelToolDefinition): AiNovelToolDefinition {
  const { minAppVersion, maxAppVersion } = tool.visibility;
  if (minAppVersion !== undefined && !parseAiNovelClientVersion(minAppVersion)) {
    throw new Error(`Invalid minimum app version for tool ${tool.name}.`);
  }
  if (maxAppVersion !== undefined && !parseAiNovelClientVersion(maxAppVersion)) {
    throw new Error(`Invalid maximum app version for tool ${tool.name}.`);
  }
  if (minAppVersion !== undefined && maxAppVersion !== undefined && !isAiNovelClientVersionAtLeast(maxAppVersion, minAppVersion)) {
    throw new Error(`Invalid app version range for tool ${tool.name}.`);
  }
  return tool;
}
