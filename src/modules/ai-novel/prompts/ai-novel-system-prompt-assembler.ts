import type { LLMMessage } from "../../../services/llm-manager.ts";
import { renderSystemPromptSections, validateSystemPromptSection, type SystemPromptContext } from "./system-prompt-section.ts";
import { WebSearchSystemSection } from "./web-search-system-section.ts";

const sections = [new WebSearchSystemSection()];
sections.forEach(validateSystemPromptSection);

export function assembleAiNovelSystemPrompt(messages: LLMMessage[], context: SystemPromptContext): LLMMessage[] {
  const index = messages.findIndex(message => message.role === "system");
  if (index < 0 || messages[index]!.content == null) return messages;
  const content = renderSystemPromptSections(messages[index]!.content!, sections, context);
  if (content === messages[index]!.content) return messages;
  return messages.map((message, i) => i === index ? { ...message, content } : message);
}
