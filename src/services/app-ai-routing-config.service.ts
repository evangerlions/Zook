import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
  AiNovelModelRoutingConfig,
  AiNovelModelRoutingTier,
  AiNovelRoutingChannel,
  AiNovelSceneRoutingConfig,
} from "../shared/types.ts";
import {
  AI_NOVEL_CHAT_SCENE_KEYS,
  AI_NOVEL_EMBEDDING_SCENE_KEYS,
} from "../modules/ai-novel/ai-novel-llm-scenes.ts";
import { shouldUseLocalAiNovelE2eProvider } from "./local-ainovel-e2e-provider.ts";

export const AI_NOVEL_APP_ID = "ai_novel";
export const AI_NOVEL_MODEL_ROUTING_CONFIG_KEY = "ai_novel.model_routing";

const VALID_TIERS = new Set<AiNovelModelRoutingTier>([
  "free",
  "plus",
  "super_plus",
]);
const VALID_CHANNELS = new Set<AiNovelRoutingChannel>(["chat", "embedding"]);

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
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(
    app: AdminAppSummary,
    revision?: number,
  ): Promise<AdminAiRoutingDocument> {
    this.assertAiNovelAppId(app.appId);
    const revisions = await this.appConfigService.listRevisions(
      app.appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    );
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(
          app.appId,
          AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
          revision,
        )
      : await this.appConfigService.getLatestRevision(
          app.appId,
          AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
        );

    if (revision && !record) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AI routing revision ${revision} was not found.`,
      );
    }

    const config = record
      ? this.parseStoredConfig(record.content)
      : await this.getCurrentConfig(app.appId);

    return {
      app,
      configKey: AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      rawJson: JSON.stringify(config, null, 2),
      updatedAt:
        record?.createdAt ??
        (await this.appConfigService.getUpdatedAt(
          app.appId,
          AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
        )),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async getCurrentConfig(appId: string): Promise<AiNovelModelRoutingConfig> {
    this.assertAiNovelAppId(appId);
    if (shouldUseLocalAiNovelE2eProvider()) {
      return this.createDefaultConfig();
    }

    const stored = await this.appConfigService.getValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    );
    return stored ? this.parseStoredConfig(stored) : this.createDefaultConfig();
  }

  async updateConfig(
    appId: string,
    rawJson: string,
    desc?: string,
  ): Promise<void> {
    this.assertAiNovelAppId(appId);
    const normalized = JSON.stringify(
      this.validateInput(this.parseInputJson(rawJson)),
      null,
      2,
    );
    await this.appConfigService.setValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      normalized,
      desc?.trim() || "ai-novel-model-routing-update",
    );
  }

  async restoreConfig(
    appId: string,
    revision: number,
    desc?: string,
  ): Promise<void> {
    this.assertAiNovelAppId(appId);
    const existing = await this.appConfigService.getRevision(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      revision,
    );
    if (!existing) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AI routing revision ${revision} was not found.`,
      );
    }
    this.parseStoredConfig(existing.content);

    await this.appConfigService.restoreValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
  }

  async initializeAppConfig(
    appId: string,
    desc = "ai-novel-model-routing-init",
  ): Promise<boolean> {
    this.assertAiNovelAppId(appId);
    const existing = await this.appConfigService.getValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
    );
    if (existing) {
      return false;
    }

    await this.appConfigService.setValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      JSON.stringify(this.createDefaultConfig(), null, 2),
      desc,
    );
    return true;
  }

  async resolveSceneRouteKey(
    appId: string,
    kind: "chat" | "embedding",
    sceneKey: string,
    tier?: AiNovelModelRoutingTier,
  ): Promise<string> {
    let config: AiNovelModelRoutingConfig;
    try {
      config = await this.getCurrentConfig(appId);
    } catch (error) {
      if (error instanceof ApplicationError && error.code !== "APP_NOT_FOUND") {
        throw new ApplicationError(
          502,
          "AI_UPSTREAM_CONFIG_INVALID",
          `AINovel scene routing config is invalid for ${kind}.${sceneKey}.`,
          { kind, sceneKey, tier: tier ?? "free" },
        );
      }
      throw error;
    }
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

  private parseStoredConfig(raw: string): AiNovelModelRoutingConfig {
    return this.validateInput(this.parseStoredJson(raw));
  }

  private parseStoredJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApplicationError(
        500,
        "SYS_INTERNAL_ERROR",
        "Stored AI routing config is invalid.",
      );
    }
  }

  private parseInputJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      badRequest("REQ_INVALID_BODY", "AI routing config must be valid JSON.");
    }
  }

  private validateInput(input: unknown): AiNovelModelRoutingConfig {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      badRequest(
        "REQ_INVALID_BODY",
        "AI routing config must be a JSON object.",
      );
    }

    const source = input as Record<string, unknown>;
    const defaultTier = this.normalizeTier(source.defaultTier);
    const scenesSource = source.scenes;
    if (
      !scenesSource ||
      typeof scenesSource !== "object" ||
      Array.isArray(scenesSource)
    ) {
      badRequest(
        "REQ_INVALID_BODY",
        "AI routing scenes must be a JSON object.",
      );
    }

    const scenes = this.normalizeScenes(
      scenesSource as Record<string, unknown>,
    );

    return {
      defaultTier,
      scenes,
    };
  }

  private normalizeTier(value: unknown): AiNovelModelRoutingTier {
    if (
      typeof value !== "string" ||
      !VALID_TIERS.has(value as AiNovelModelRoutingTier)
    ) {
      badRequest(
        "REQ_INVALID_BODY",
        `defaultTier must be one of: ${[...VALID_TIERS].join(", ")}.`,
      );
    }
    return value as AiNovelModelRoutingTier;
  }

  private normalizeScenes(
    source: Record<string, unknown>,
  ): Record<string, AiNovelSceneRoutingConfig> {
    const normalized: Record<string, AiNovelSceneRoutingConfig> = {};
    const expectedScenes = new Map<string, AiNovelRoutingChannel>([
      ...AI_NOVEL_CHAT_SCENE_KEYS.map(
        (sceneKey) => [sceneKey, "chat"] as const,
      ),
      ...AI_NOVEL_EMBEDDING_SCENE_KEYS.map(
        (sceneKey) => [sceneKey, "embedding"] as const,
      ),
    ]);

    for (const [sceneKey, kind] of expectedScenes) {
      normalized[sceneKey] = this.normalizeSceneConfig(
        source[sceneKey],
        sceneKey,
        kind,
      );
    }

    for (const key of Object.keys(source)) {
      if (!expectedScenes.has(key)) {
        badRequest(
          "REQ_INVALID_BODY",
          `AI routing scenes contains unsupported scene key: ${key}.`,
        );
      }
    }

    return normalized;
  }

  private normalizeSceneConfig(
    value: unknown,
    sceneKey: string,
    expectedKind: AiNovelRoutingChannel,
  ): AiNovelSceneRoutingConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest(
        "REQ_INVALID_BODY",
        `scenes.${sceneKey} must be a JSON object.`,
      );
    }

    const source = value as Record<string, unknown>;
    const kind = source.kind;
    if (
      typeof kind !== "string" ||
      !VALID_CHANNELS.has(kind as AiNovelRoutingChannel)
    ) {
      badRequest(
        "REQ_INVALID_BODY",
        `scenes.${sceneKey}.kind must be one of: ${[...VALID_CHANNELS].join(", ")}.`,
      );
    }
    if (kind !== expectedKind) {
      badRequest(
        "REQ_INVALID_BODY",
        `scenes.${sceneKey}.kind must be ${expectedKind}.`,
      );
    }
    const normalizedKind = kind as AiNovelRoutingChannel;

    const routesSource = source.routes;
    if (
      !routesSource ||
      typeof routesSource !== "object" ||
      Array.isArray(routesSource)
    ) {
      badRequest(
        "REQ_INVALID_BODY",
        `scenes.${sceneKey}.routes must be a JSON object.`,
      );
    }

    const routes = this.normalizeSceneRoutes(
      routesSource as Record<string, unknown>,
      sceneKey,
    );
    return {
      kind: normalizedKind,
      routes,
    };
  }

  private normalizeSceneRoutes(
    source: Record<string, unknown>,
    sceneKey: string,
  ): Record<AiNovelModelRoutingTier, string> {
    const routes = {} as Record<AiNovelModelRoutingTier, string>;
    for (const tier of VALID_TIERS) {
      const sceneRouteKey = source[tier];
      if (typeof sceneRouteKey !== "string" || !sceneRouteKey.trim()) {
        badRequest(
          "REQ_INVALID_BODY",
          `scenes.${sceneKey}.routes.${tier} must be a non-empty string.`,
        );
      }
      routes[tier] = sceneRouteKey.trim();
    }

    for (const key of Object.keys(source)) {
      if (!VALID_TIERS.has(key as AiNovelModelRoutingTier)) {
        badRequest(
          "REQ_INVALID_BODY",
          `scenes.${sceneKey}.routes contains unsupported tier: ${key}.`,
        );
      }
    }

    return routes;
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
