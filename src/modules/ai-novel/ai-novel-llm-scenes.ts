import { badRequest } from "../../shared/errors.ts";

export type AiNovelSceneKind = "chat" | "embedding";
export type AiNovelSceneResponseMode = "text" | "json" | "embedding";

export interface AiNovelChatScene {
  taskType: string;
  kind: "chat";
  defaultModelKey: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  responseMode: Exclude<AiNovelSceneResponseMode, "embedding">;
}

export interface AiNovelEmbeddingScene {
  taskType: string;
  kind: "embedding";
  defaultModelKey: string;
  responseMode: "embedding";
}

const CHAT_SCENES: Record<string, AiNovelChatScene> = {
  setup_turn: {
    taskType: "setup_turn",
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
