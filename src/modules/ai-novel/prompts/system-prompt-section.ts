import { isAiNovelClientVersionAtLeast, isAiNovelClientVersionAtMost, parseAiNovelClientVersion } from "../ai-novel-client-version.ts";
import type { AiNovelAgentProtocol } from "../ai-novel-llm-request-validation.ts";

export const TOOL_GUIDANCE_PLACEHOLDER = "{{tool_guidance}}";

export interface SystemPromptSection {
  readonly content: string;
  readonly placeholder: typeof TOOL_GUIDANCE_PLACEHOLDER;
  readonly position: number;
  readonly scope: {
    readonly scenes: readonly string[];
    readonly minAppVersion?: string;
    readonly maxAppVersion?: string;
    readonly agentProtocol?: AiNovelAgentProtocol;
    readonly requiredTool?: string;
  };
}

export interface SystemPromptContext {
  sceneKey: string;
  appVersion?: string;
  agentProtocol?: AiNovelAgentProtocol;
  availableTools: readonly string[];
}

export function validateSystemPromptSection(section: SystemPromptSection): void {
  const { minAppVersion, maxAppVersion } = section.scope;
  if ((minAppVersion !== undefined && !parseAiNovelClientVersion(minAppVersion)) ||
      (maxAppVersion !== undefined && !parseAiNovelClientVersion(maxAppVersion)) ||
      (minAppVersion !== undefined && maxAppVersion !== undefined && !isAiNovelClientVersionAtLeast(maxAppVersion, minAppVersion))) {
    throw new Error("Invalid system prompt section version range.");
  }
  if (!Number.isFinite(section.position)) throw new Error("Invalid system prompt section position.");
}

export function renderSystemPromptSections(template: string, sections: readonly SystemPromptSection[], context: SystemPromptContext): string {
  const applicable = sections.filter(({ scope }) =>
    scope.scenes.includes(context.sceneKey) &&
    (!scope.minAppVersion || isAiNovelClientVersionAtLeast(context.appVersion, scope.minAppVersion)) &&
    (!scope.maxAppVersion || isAiNovelClientVersionAtMost(context.appVersion, scope.maxAppVersion)) &&
    (!scope.agentProtocol || scope.agentProtocol === context.agentProtocol) &&
    (!scope.requiredTool || context.availableTools.includes(scope.requiredTool))
  ).slice().sort((left, right) => left.position - right.position);
  for (const section of applicable) {
    if (!template.includes(section.placeholder)) throw new Error(`Missing system prompt placeholder: ${section.placeholder}`);
  }
  const content = applicable.map(section => section.content).join("\n");
  return template.replace(`${TOOL_GUIDANCE_PLACEHOLDER}\n`, content ? `${content}\n` : "")
    .replace(TOOL_GUIDANCE_PLACEHOLDER, content);
}
