import { badRequest } from "../../shared/errors.ts";
import type { AiNovelPromptProfile } from "./prompts/ai-novel-prompt-types.ts";

export type AiNovelSceneKind = "chat" | "embedding";
export type AiNovelSceneResponseMode = "text" | "json" | "embedding";
export type AiNovelChatSceneProfile = AiNovelPromptProfile;

export interface AiNovelChatScene {
  sceneKey: string;
  kind: "chat";
  defaultSceneRouteKey: string;
  defaultTemperature: number;
  defaultMaxTokens: number;
  responseMode: Exclude<AiNovelSceneResponseMode, "embedding">;
  profile?: AiNovelChatSceneProfile;
  requiresStream?: boolean;
  supportsStream?: boolean;
  completeViaStream?: boolean;
}

export interface AiNovelEmbeddingScene {
  sceneKey: string;
  kind: "embedding";
  defaultSceneRouteKey: string;
  responseMode: "embedding";
}

const CHAT_SCENES: Record<string, AiNovelChatScene> = {
  kickoff_turn: {
    sceneKey: "kickoff_turn",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-free-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 4000,
    responseMode: "text",
  },
  kickoff_turn_imported_book: {
    sceneKey: "kickoff_turn_imported_book",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-plus-reasoning",
    defaultTemperature: 0.25,
    defaultMaxTokens: 5000,
    responseMode: "text",
    profile: "kickoff_turn_imported_book",
    requiresStream: true,
  },
  chat_compaction: {
    sceneKey: "chat_compaction",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 3000,
    responseMode: "text",
    supportsStream: false,
  },
  write_turn: {
    sceneKey: "write_turn",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-free-creative",
    defaultTemperature: 0.55,
    defaultMaxTokens: 8000,
    responseMode: "text",
    profile: "write_turn",
    requiresStream: true,
  },
  chapter_draft: {
    sceneKey: "chapter_draft",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-free-creative",
    defaultTemperature: 0.65,
    defaultMaxTokens: 20000,
    responseMode: "text",
    profile: "chapter_draft",
    requiresStream: true,
  },
  import_book_agent: {
    sceneKey: "import_book_agent",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-plus-reasoning",
    defaultTemperature: 0.2,
    defaultMaxTokens: 6000,
    responseMode: "text",
    profile: "import_book_agent",
    supportsStream: true,
    completeViaStream: true,
  },
  chapter_summary: {
    sceneKey: "chapter_summary",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 3000,
    responseMode: "json",
    profile: "chapter_summary",
    supportsStream: true,
    completeViaStream: true,
  },
  chapter_draft_review: {
    sceneKey: "chapter_draft_review",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 3000,
    responseMode: "json",
    profile: "chapter_draft_review",
    supportsStream: true,
    completeViaStream: true,
  },
  snapshot_generation: {
    sceneKey: "snapshot_generation",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-lowcost-structured",
    defaultTemperature: 0,
    defaultMaxTokens: 4000,
    responseMode: "json",
    profile: "snapshot_generation",
    supportsStream: true,
    completeViaStream: true,
  },
  next_chapter_brief: {
    sceneKey: "next_chapter_brief",
    kind: "chat",
    defaultSceneRouteKey: "ainovel-lowcost-structured",
    defaultTemperature: 0.15,
    defaultMaxTokens: 3000,
    responseMode: "json",
    profile: "next_chapter_brief",
    supportsStream: true,
    completeViaStream: true,
  },
};

const EMBEDDING_SCENES: Record<string, AiNovelEmbeddingScene> = {
  fact_embed: {
    sceneKey: "fact_embed",
    kind: "embedding",
    defaultSceneRouteKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  episode_embed: {
    sceneKey: "episode_embed",
    kind: "embedding",
    defaultSceneRouteKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  summary_embed: {
    sceneKey: "summary_embed",
    kind: "embedding",
    defaultSceneRouteKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
  query_memory_embed: {
    sceneKey: "query_memory_embed",
    kind: "embedding",
    defaultSceneRouteKey: "ainovel-embedding-default",
    responseMode: "embedding",
  },
};

const CHAT_ALIASES: Record<string, string> = {};

export const AI_NOVEL_CHAT_SCENE_KEYS = Object.freeze(Object.keys(CHAT_SCENES));
export const AI_NOVEL_EMBEDDING_SCENE_KEYS = Object.freeze(
  Object.keys(EMBEDDING_SCENES),
);

export function resolveAiNovelChatScene(sceneKey: string): AiNovelChatScene {
  const normalized = normalizeSceneKey(sceneKey);
  const canonical = CHAT_ALIASES[normalized] ?? normalized;
  const scene = CHAT_SCENES[canonical];
  if (!scene) {
    badRequest(
      "AI_SCENE_NOT_SUPPORTED",
      `Unsupported ai_novel chat sceneKey: ${sceneKey}.`,
    );
  }
  return scene;
}

export function resolveAiNovelEmbeddingScene(
  sceneKey: string,
): AiNovelEmbeddingScene {
  const normalized = normalizeSceneKey(sceneKey);
  const scene = EMBEDDING_SCENES[normalized];
  if (!scene) {
    badRequest(
      "AI_SCENE_NOT_SUPPORTED",
      `Unsupported ai_novel embedding sceneKey: ${sceneKey}.`,
    );
  }
  return scene;
}

function normalizeSceneKey(sceneKey: string): string {
  return sceneKey.trim().toLowerCase();
}
