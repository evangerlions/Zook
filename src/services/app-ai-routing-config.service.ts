import { ApplicationError } from "../shared/errors.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import type { VersionedAppConfigService } from "./versioned-app-config.service.ts";
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
export const LIGHTTICK_APP_ID = "lighttick";
export const LIGHTTICK_AI_ROUTING_CONFIG_KEY = "lighttick.ai_routing";

type LightTickSceneOverride = { modelAlias: string; timeoutMs: number; maxContextTokens: number;
  maxOutputTokens: number; maxEstimatedCostUsd: number; fallback: string };
type LightTickAiRoutingConfig = { scenes: Record<LightTickAiSceneName, LightTickSceneOverride> };

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
  constructor(private readonly appConfigService?: VersionedAppConfigService) {}

  async getDocument(
    app: AdminAppSummary,
    revision?: number,
  ): Promise<AdminAiRoutingDocument> {
    if (app.appId === LIGHTTICK_APP_ID) return this.getLightTickDocument(app, revision);
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
    if (appId === LIGHTTICK_APP_ID) {
      const config = this.parseLightTickConfig(rawJson);
      await this.requireVersionedConfig().setValue(appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY,
        JSON.stringify(config, null, 2), desc?.trim() || "Update LightTick AI routing");
      return;
    }
    this.assertAiNovelAppId(appId); void rawJson; void desc;
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
    if (appId === LIGHTTICK_APP_ID) {
      await this.requireVersionedConfig().restoreValue(appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY, revision,
        desc?.trim() || `Restore LightTick AI routing to R${revision}`);
      return;
    }
    this.assertAiNovelAppId(appId); void revision; void desc;
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

  async resolveLightTickScene(sceneName: LightTickAiSceneName) {
    const config = await this.getCurrentLightTickConfig();
    return { ...LIGHTTICK_AI_SCENES[sceneName], ...config.scenes[sceneName] };
  }

  private async getCurrentLightTickConfig(): Promise<LightTickAiRoutingConfig> {
    const service = this.requireVersionedConfig();
    let value = await service.getValue(LIGHTTICK_APP_ID, LIGHTTICK_AI_ROUTING_CONFIG_KEY);
    if (!value) {
      value = JSON.stringify(this.createDefaultLightTickConfig(), null, 2);
      await service.setValue(LIGHTTICK_APP_ID, LIGHTTICK_AI_ROUTING_CONFIG_KEY, value, "Initial LightTick AI routing");
    }
    return this.parseLightTickConfig(value);
  }

  private async getLightTickDocument(app: AdminAppSummary, revision?: number): Promise<AdminAiRoutingDocument> {
    await this.getCurrentLightTickConfig();
    const service = this.requireVersionedConfig();
    const record = revision
      ? await service.getRevision(app.appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY, revision)
      : await service.getLatestRevision(app.appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY);
    if (!record) throw new ApplicationError(404, "REQ_INVALID_QUERY", `LightTick AI routing revision ${revision} was not found.`);
    const revisions = await service.listRevisions(app.appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY);
    return { app, configKey: LIGHTTICK_AI_ROUTING_CONFIG_KEY, rawJson: record.content, updatedAt: record.createdAt,
      revision: record.revision, desc: record.desc, isLatest: record.revision === revisions.at(-1)?.revision,
      revisions: [...revisions].reverse() };
  }

  private createDefaultLightTickConfig(): LightTickAiRoutingConfig {
    return { scenes: Object.fromEntries(Object.entries(LIGHTTICK_AI_SCENES).map(([key, scene]) => [key, {
      modelAlias: scene.modelAlias, timeoutMs: scene.timeoutMs, maxContextTokens: scene.maxContextTokens,
      maxOutputTokens: scene.maxOutputTokens, maxEstimatedCostUsd: scene.maxEstimatedCostUsd, fallback: scene.fallback,
    }])) as LightTickAiRoutingConfig["scenes"] };
  }

  private parseLightTickConfig(rawJson: string): LightTickAiRoutingConfig {
    let parsed: any;
    try { parsed = JSON.parse(rawJson); } catch { throw new ApplicationError(400, "REQ_INVALID_BODY", "LightTick AI routing must be valid JSON."); }
    for (const name of Object.keys(LIGHTTICK_AI_SCENES) as LightTickAiSceneName[]) {
      const scene = parsed?.scenes?.[name];
      if (!scene || typeof scene.modelAlias !== "string" || !scene.modelAlias.trim() ||
        !Number.isInteger(scene.timeoutMs) || scene.timeoutMs < 1000 || !Number.isInteger(scene.maxContextTokens) || scene.maxContextTokens < 1 ||
        !Number.isInteger(scene.maxOutputTokens) || scene.maxOutputTokens < 1 || typeof scene.maxEstimatedCostUsd !== "number" || scene.maxEstimatedCostUsd < 0 ||
        scene.maxEstimatedCostUsd > LIGHTTICK_AI_SCENES[name].maxEstimatedCostUsd ||
        !["template", "facts_only", "none"].includes(scene.fallback))
        throw new ApplicationError(400, "REQ_INVALID_BODY", `Invalid LightTick AI routing scene: ${name}.`);
    }
    return parsed as LightTickAiRoutingConfig;
  }

  private requireVersionedConfig(): VersionedAppConfigService {
    if (!this.appConfigService) throw new ApplicationError(503, "AI_UPSTREAM_CONFIG_INVALID", "Versioned AI routing is unavailable.");
    return this.appConfigService;
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
