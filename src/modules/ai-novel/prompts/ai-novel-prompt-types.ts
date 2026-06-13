import type { LLMMessage, LLMToolDefinition } from "../../../services/llm-manager.ts";

export type AiNovelPromptProfile =
  | "write_turn"
  | "chapter_draft"
  | "import_book_agent"
  | "chapter_summary"
  | "chapter_draft_review"
  | "snapshot_generation"
  | "next_chapter_brief";

export interface AiNovelPromptAssembly {
  messages: LLMMessage[];
  tools: LLMToolDefinition[];
  forcedToolName?: string;
}
