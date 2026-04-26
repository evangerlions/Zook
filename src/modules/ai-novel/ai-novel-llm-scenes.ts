import { badRequest } from "../../shared/errors.ts";

export type AiNovelSceneKind = "chat" | "embedding";
export type AiNovelSceneResponseMode = "text" | "json" | "embedding";
export type AiNovelChatSceneProfile =
  | "write_turn"
  | "chapter_draft"
  | "chapter_summary"
  | "future_instruction_cleanup"
  | "main_line_review"
  | "snapshot_generation"
  | "next_chapter_brief";

export interface AiNovelChatScene {
  taskType: string;
  kind: "chat";
  defaultModelKey: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  responseMode: Exclude<AiNovelSceneResponseMode, "embedding">;
  profile?: AiNovelChatSceneProfile;
  requiresStream?: boolean;
  supportsStream?: boolean;
}

export interface AiNovelEmbeddingScene {
  taskType: string;
  kind: "embedding";
  defaultModelKey: string;
  responseMode: "embedding";
}

const CHAT_SCENES: Record<string, AiNovelChatScene> = {
  kickoff_turn: {
    taskType: "kickoff_turn",
    kind: "chat",
    defaultModelKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 2000,
    responseMode: "text",
  },
  blueprint_gen: {
    taskType: "blueprint_gen",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.7,
    defaultMaxTokens: 2200,
    responseMode: "text",
  },
  chapter1_draft_gen: {
    taskType: "chapter1_draft_gen",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.7,
    defaultMaxTokens: 2600,
    responseMode: "text",
  },
  chapter1_critic: {
    taskType: "chapter1_critic",
    kind: "chat",
    defaultModelKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 1600,
    responseMode: "json",
  },
  fact_extract: {
    taskType: "fact_extract",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 2400,
    responseMode: "json",
  },
  episode_extract: {
    taskType: "episode_extract",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 2400,
    responseMode: "json",
  },
  continue_chapter: {
    taskType: "continue_chapter",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.65,
    defaultMaxTokens: 4000,
    responseMode: "text",
  },
  chapter_transition: {
    taskType: "chapter_transition",
    kind: "chat",
    defaultModelKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 2200,
    responseMode: "json",
  },
  chapter2_planner: {
    taskType: "chapter2_planner",
    kind: "chat",
    defaultModelKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 2400,
    responseMode: "json",
  },
  chapter2_draft_gen: {
    taskType: "chapter2_draft_gen",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.65,
    defaultMaxTokens: 4000,
    responseMode: "text",
  },
  write_turn: {
    taskType: "write_turn",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.55,
    defaultMaxTokens: 4000,
    responseMode: "text",
    profile: "write_turn",
    requiresStream: true,
  },
  chapter_draft: {
    taskType: "chapter_draft",
    kind: "chat",
    defaultModelKey: "ainovel-free-creative",
    defaultTemperature: 0.65,
    defaultMaxTokens: 5000,
    responseMode: "text",
    profile: "chapter_draft",
    requiresStream: true,
  },
  chapter_summary: {
    taskType: "chapter_summary",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 1600,
    responseMode: "json",
    profile: "chapter_summary",
    supportsStream: false,
  },
  future_instruction_cleanup: {
    taskType: "future_instruction_cleanup",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 1800,
    responseMode: "json",
    profile: "future_instruction_cleanup",
    supportsStream: false,
  },
  main_line_review: {
    taskType: "main_line_review",
    kind: "chat",
    defaultModelKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 1800,
    responseMode: "json",
    profile: "main_line_review",
    supportsStream: false,
  },
  snapshot_generation: {
    taskType: "snapshot_generation",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 2600,
    responseMode: "json",
    profile: "snapshot_generation",
    supportsStream: false,
  },
  next_chapter_brief: {
    taskType: "next_chapter_brief",
    kind: "chat",
    defaultModelKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 1400,
    responseMode: "json",
    profile: "next_chapter_brief",
    supportsStream: false,
  },
};

const EMBEDDING_SCENES: Record<string, AiNovelEmbeddingScene> = {
  fact_embed: {
    taskType: "fact_embed",
    kind: "embedding",
    defaultModelKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  episode_embed: {
    taskType: "episode_embed",
    kind: "embedding",
    defaultModelKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  summary_embed: {
    taskType: "summary_embed",
    kind: "embedding",
    defaultModelKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  query_memory_embed: {
    taskType: "query_memory_embed",
    kind: "embedding",
    defaultModelKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
};

const CHAT_ALIASES: Record<string, string> = {
  chapter_planner: "chapter2_planner",
  chapter_draft_gen: "chapter2_draft_gen",
};

export const AI_NOVEL_CHAT_TASK_TYPES = Object.freeze(Object.keys(CHAT_SCENES));
export const AI_NOVEL_EMBEDDING_TASK_TYPES = Object.freeze(Object.keys(EMBEDDING_SCENES));

export function resolveAiNovelChatScene(taskType: string): AiNovelChatScene {
  const normalized = normalizeTaskType(taskType);
  const canonical = CHAT_ALIASES[normalized] ?? normalized;
  const scene = CHAT_SCENES[canonical];
  if (!scene) {
    badRequest("AI_TASK_TYPE_NOT_SUPPORTED", `Unsupported ai_novel chat taskType: ${taskType}.`);
  }
  return scene;
}

export function resolveAiNovelEmbeddingScene(taskType: string): AiNovelEmbeddingScene {
  const normalized = normalizeTaskType(taskType);
  const scene = EMBEDDING_SCENES[normalized];
  if (!scene) {
    badRequest("AI_TASK_TYPE_NOT_SUPPORTED", `Unsupported ai_novel embedding taskType: ${taskType}.`);
  }
  return scene;
}

function normalizeTaskType(taskType: string): string {
  return taskType.trim().toLowerCase();
}
