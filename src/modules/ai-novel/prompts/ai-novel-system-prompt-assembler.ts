import type { LLMMessage } from "../../../services/llm-manager.ts";
import { renderSystemPromptSections, validateSystemPromptSection, type SystemPromptContext } from "./system-prompt-section.ts";
import { WebSearchSystemSection } from "./web-search-system-section.ts";

const sections = [new WebSearchSystemSection()];
sections.forEach(validateSystemPromptSection);

export function assembleAiNovelSystemPrompt(messages: LLMMessage[], context: SystemPromptContext): LLMMessage[] {
  const index = messages.findIndex(message => message.role === "system");
  return messages.map((message, i) => i === index && message.content != null
    ? { ...message, content: renderSystemPromptSections(message.content, sections, context) }
    : message);
}
