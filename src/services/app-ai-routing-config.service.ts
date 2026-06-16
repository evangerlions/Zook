import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
  AiNovelModelRoutingConfig,
  AiNovelModelRoutingTier,
  AiNovelRoutingChannel,
  AiNovelSceneRoutingConfig,
} from "../shared/types.ts";

export const AI_NOVEL_APP_ID = "ai_novel";
export const AI_NOVEL_MODEL_ROUTING_CONFIG_KEY = "ai_novel.model_routing";

function sceneRoute(
  kind: AiNovelRoutingChannel,
  free: string,
  plus = free,
  superPlus = plus,
): AiNovelSceneRoutingConfig {
  return {
    kind,
    routes: {
      free,
      plus,
      super_plus: superPlus,
    },
  };
}

const DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG: AiNovelModelRoutingConfig = {
  defaultTier: "free",
  scenes: {
    kickoff_turn: sceneRoute(
      "chat",
      "ainovel-plus-reasoning",
      "ainovel-plus-reasoning",
      "ainovel-super-reasoning",
    ),
    kickoff_turn_imported_book: sceneRoute(
      "chat",
      "ainovel-plus-reasoning",
      "ainovel-plus-reasoning",
      "ainovel-super-reasoning",
    ),
    chat_compaction: sceneRoute("chat", "ainovel-lowcost-structured"),
    write_turn: sceneRoute(
      "chat",
      "ainovel-free-creative",
      "ainovel-plus-creative",
      "ainovel-super-creative",
    ),
    chapter_draft: sceneRoute(
      "chat",
      "ainovel-free-creative",
      "ainovel-plus-creative",
      "ainovel-super-creative",
    ),
    import_book_agent: sceneRoute(
      "chat",
      "ainovel-plus-reasoning",
      "ainovel-plus-reasoning",
      "ainovel-super-reasoning",
    ),
    chapter_summary: sceneRoute("chat", "ainovel-lowcost-structured"),
    chapter_draft_review: sceneRoute("chat", "ainovel-lowcost-structured"),
    snapshot_generation: sceneRoute("chat", "ainovel-lowcost-structured"),
    next_chapter_brief: sceneRoute("chat", "ainovel-lowcost-structured"),
    fact_embed: sceneRoute("embedding", "ainovel-embedding-default"),
    episode_embed: sceneRoute("embedding", "ainovel-embedding-default"),
    summary_embed: sceneRoute("embedding", "ainovel-embedding-default"),
    query_memory_embed: sceneRoute("embedding", "ainovel-embedding-default"),
  },
};

export class AppAiRoutingConfigService {
  async getDocument(
    app: AdminAppSummary,
    revision?: number,
  ): Promise<AdminAiRoutingDocument> {
    this.assertAiNovelAppId(app.appId);
    if (revision) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        "AI routing is hardcoded and has no admin revisions.",
      );
    }

    return {
      app,
      configKey: AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      rawJson: JSON.stringify(this.createDefaultConfig(), null, 2),
      desc: "hardcoded",
      isLatest: true,
      revisions: [],
    };
  }

  async getCurrentConfig(appId: string): Promise<AiNovelModelRoutingConfig> {
    this.assertAiNovelAppId(appId);
    return this.createDefaultConfig();
  }

  async updateConfig(
    appId: string,
    rawJson: string,
    desc?: string,
  ): Promise<void> {
    this.assertAiNovelAppId(appId);
    void rawJson;
    void desc;
    throw new ApplicationError(
      400,
      "REQ_INVALID_BODY",
      "AI routing is hardcoded and cannot be updated from admin config.",
    );
  }

  async restoreConfig(
    appId: string,
    revision: number,
    desc?: string,
  ): Promise<void> {
    this.assertAiNovelAppId(appId);
    void revision;
    void desc;
    throw new ApplicationError(
      404,
      "REQ_INVALID_QUERY",
      "AI routing is hardcoded and has no admin revisions.",
    );
  }

  async resolveSceneRouteKey(
    appId: string,
    kind: "chat" | "embedding",
    sceneKey: string,
    tier?: AiNovelModelRoutingTier,
  ): Promise<string> {
    const config = await this.getCurrentConfig(appId);
    const resolvedTier = tier ?? config.defaultTier;
    const sceneConfig = config.scenes[sceneKey];
    if (sceneConfig?.kind !== kind) {
      throw new ApplicationError(
        502,
        "AI_UPSTREAM_CONFIG_INVALID",
        `AINovel scene routing kind mismatch for ${kind}.${sceneKey}.`,
        {
          tier: resolvedTier,
          sceneKey,
          kind,
          configuredKind: sceneConfig?.kind,
        },
      );
    }

    const sceneRouteKey = sceneConfig.routes[resolvedTier];
    if (!sceneRouteKey?.trim()) {
      throw new ApplicationError(
        502,
        "AI_UPSTREAM_CONFIG_INVALID",
        `AINovel scene routing is missing ${resolvedTier} route for ${kind}.${sceneKey}.`,
        {
          tier: resolvedTier,
          sceneKey,
          kind,
        },
      );
    }

    return sceneRouteKey.trim();
  }

  createDefaultConfig(): AiNovelModelRoutingConfig {
    return structuredClone(DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG);
  }

  private assertAiNovelAppId(appId: string): void {
    if (appId !== AI_NOVEL_APP_ID) {
      throw new ApplicationError(
        404,
        "APP_NOT_FOUND",
        `AI routing is not supported for app ${appId}.`,
      );
    }
  }
}
