import type {
  LLMMessage,
  LLMToolDefinition,
} from "../../../services/llm-manager.ts";

export type AiNovelPromptProfile =
  | "write_turn"
  | "history_chapter_qa"
  | "chapter_draft"
  | "kickoff_turn_imported_book"
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
