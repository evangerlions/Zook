import { ApplicationError } from "../../../shared/errors.ts";
import { isAiNovelClientVersionAtLeast, isAiNovelClientVersionAtMost } from "../ai-novel-client-version.ts";
import type { AiNovelAgentProtocol } from "../ai-novel-llm-request-validation.ts";
import type { AiNovelToolDefinition } from "./ai-novel-tool-definition.ts";

export interface AiNovelToolClient {
  appVersion?: string;
  agentProtocol?: AiNovelAgentProtocol;
  skillsEnabled?: boolean;
}

export function isAiNovelToolVisible(tool: AiNovelToolDefinition, client: AiNovelToolClient): boolean {
  const { visibility } = tool;
  if (visibility.minAppVersion && !isAiNovelClientVersionAtLeast(client.appVersion, visibility.minAppVersion)) return false;
  if (visibility.maxAppVersion && !isAiNovelClientVersionAtMost(client.appVersion, visibility.maxAppVersion)) return false;
  if (visibility.agentProtocol && visibility.agentProtocol !== client.agentProtocol) return false;
  if (visibility.requiresSkills && !client.skillsEnabled) return false;
  return true;
}

export function filterAiNovelAgentTools(
  tools: readonly AiNovelToolDefinition[],
  client: AiNovelToolClient & { context?: unknown },
): AiNovelToolDefinition[] {
  const visible = tools.filter((tool) => isAiNovelToolVisible(tool, client));
  if (client.agentProtocol !== "pi-v1") return visible;
  if (!client.context || typeof client.context !== "object") return [];
  const supplied = (client.context as Record<string, unknown>).suppliedTools;
  if (!Array.isArray(supplied)) return [];
  const allowed = new Set(supplied.filter((name): name is string => typeof name === "string"));
  return visible.filter((tool) => allowed.has(tool.name));
}

/** Required output tools are server-owned, independent of suppliedTools. */
export function requireVisibleAiNovelTool(tool: AiNovelToolDefinition, client: AiNovelToolClient): AiNovelToolDefinition {
  if (!isAiNovelToolVisible(tool, client)) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", `Client does not support required tool ${tool.name}.`);
  }
  return tool;
}
