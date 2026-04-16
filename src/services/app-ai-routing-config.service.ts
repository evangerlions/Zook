import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
  AiNovelModelRoutingConfig,
  AiNovelModelRoutingTier,
  AiNovelTierRoutingConfig,
} from "../shared/types.ts";
import { AI_NOVEL_CHAT_TASK_TYPES, AI_NOVEL_EMBEDDING_TASK_TYPES } from "../modules/ai-novel/ai-novel-llm-scenes.ts";

export const AI_NOVEL_APP_ID = "ai_novel";
export const AI_NOVEL_MODEL_ROUTING_CONFIG_KEY = "ai_novel.model_routing";

const VALID_TIERS = new Set<AiNovelModelRoutingTier>(["free", "plus", "super_plus"]);

const DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG: AiNovelModelRoutingConfig = {
  defaultTier: "free",
  tiers: {
    free: {
      chat: {
        setup_turn: "ainovel-plus-reasoning",
        blueprint_gen: "ainovel-free-creative",
        chapter1_draft_gen: "ainovel-free-creative",
        chapter1_critic: "ainovel-free-reasoning",
        fact_extract: "ainovel-lowcost-structured",
        episode_extract: "ainovel-lowcost-structured",
        continue_chapter: "ainovel-free-creative",
        chapter_transition: "ainovel-free-reasoning",
        chapter2_planner: "ainovel-free-reasoning",
        chapter2_draft_gen: "ainovel-free-creative",
      },
      embedding: {
        fact_embed: "ainovel-embedding-default",
        episode_embed: "ainovel-embedding-default",
        summary_embed: "ainovel-embedding-default",
        query_memory_embed: "ainovel-embedding-default",
      },
    },
    plus: {
      chat: {
        setup_turn: "ainovel-plus-reasoning",
        blueprint_gen: "ainovel-plus-creative",
        chapter1_draft_gen: "ainovel-plus-creative",
        chapter1_critic: "ainovel-plus-reasoning",
        fact_extract: "ainovel-lowcost-structured",
        episode_extract: "ainovel-lowcost-structured",
        continue_chapter: "ainovel-plus-creative",
        chapter_transition: "ainovel-plus-reasoning",
        chapter2_planner: "ainovel-plus-reasoning",
        chapter2_draft_gen: "ainovel-plus-creative",
      },
      embedding: {
        fact_embed: "ainovel-embedding-default",
        episode_embed: "ainovel-embedding-default",
        summary_embed: "ainovel-embedding-default",
        query_memory_embed: "ainovel-embedding-default",
      },
    },
    super_plus: {
      chat: {
        setup_turn: "ainovel-super-reasoning",
        blueprint_gen: "ainovel-super-creative",
        chapter1_draft_gen: "ainovel-super-creative",
        chapter1_critic: "ainovel-super-reasoning",
        fact_extract: "ainovel-lowcost-structured",
        episode_extract: "ainovel-lowcost-structured",
        continue_chapter: "ainovel-super-creative",
        chapter_transition: "ainovel-super-reasoning",
        chapter2_planner: "ainovel-super-reasoning",
        chapter2_draft_gen: "ainovel-super-creative",
      },
      embedding: {
        fact_embed: "ainovel-embedding-default",
        episode_embed: "ainovel-embedding-default",
        summary_embed: "ainovel-embedding-default",
        query_memory_embed: "ainovel-embedding-default",
      },
    },
  },
};

export class AppAiRoutingConfigService {
  constructor(private readonly appConfigService: VersionedAppConfigService) {}

  async getDocument(app: AdminAppSummary, revision?: number): Promise<AdminAiRoutingDocument> {
    this.assertAiNovelAppId(app.appId);
    const revisions = await this.appConfigService.listRevisions(app.appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY);
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(app.appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY, revision)
      : await this.appConfigService.getLatestRevision(app.appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY);

    if (revision && !record) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `AI routing revision ${revision} was not found.`);
    }

    const config = record
      ? this.parseStoredConfig(record.content)
      : await this.getCurrentConfig(app.appId);

    return {
      app,
      configKey: AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      rawJson: JSON.stringify(config, null, 2),
      updatedAt: record?.createdAt ?? await this.appConfigService.getUpdatedAt(app.appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
      revisions: [...revisions].reverse(),
    };
  }

  async getCurrentConfig(appId: string): Promise<AiNovelModelRoutingConfig> {
    this.assertAiNovelAppId(appId);
    const stored = await this.appConfigService.getValue(appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY);
    return stored ? this.parseStoredConfig(stored) : this.createDefaultConfig();
  }

  async updateConfig(appId: string, rawJson: string, desc?: string): Promise<void> {
    this.assertAiNovelAppId(appId);
    const normalized = JSON.stringify(this.validateInput(this.parseInputJson(rawJson)), null, 2);
    await this.appConfigService.setValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      normalized,
      desc?.trim() || "ai-novel-model-routing-update",
    );
  }

  async restoreConfig(appId: string, revision: number, desc?: string): Promise<void> {
    this.assertAiNovelAppId(appId);
    const existing = await this.appConfigService.getRevision(appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY, revision);
    if (!existing) {
      throw new ApplicationError(404, "REQ_INVALID_QUERY", `AI routing revision ${revision} was not found.`);
    }

    await this.appConfigService.restoreValue(
      appId,
      AI_NOVEL_MODEL_ROUTING_CONFIG_KEY,
      revision,
      desc?.trim() || `恢复到版本 R${revision}`,
    );
  }

  async initializeAppConfig(appId: string, desc = "ai-novel-model-routing-init"): Promise<boolean> {
    this.assertAiNovelAppId(appId);
    const existing = await this.appConfigService.getValue(appId, AI_NOVEL_MODEL_ROUTING_CONFIG_KEY);
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

  async resolveModelKey(
    appId: string,
    kind: "chat" | "embedding",
    taskType: string,
    tier?: AiNovelModelRoutingTier,
  ): Promise<string> {
    let config: AiNovelModelRoutingConfig;
    try {
      config = await this.getCurrentConfig(appId);
    } catch (error) {
      if (error instanceof ApplicationError && error.code !== "APP_NOT_FOUND") {
        throw new ApplicationError(
          502,
          "AI_UPSTREAM_BAD_GATEWAY",
          `AINovel model routing config is invalid for ${kind}.${taskType}.`,
          { kind, taskType, tier: tier ?? "free" },
        );
      }
      throw error;
    }
    const resolvedTier = tier ?? config.defaultTier;
    const tierConfig = config.tiers[resolvedTier];
    const modelKey = tierConfig?.[kind]?.[taskType];
    if (!modelKey?.trim()) {
      throw new ApplicationError(
        502,
        "AI_UPSTREAM_BAD_GATEWAY",
        `AINovel model routing is missing ${kind} mapping for ${resolvedTier}.${taskType}.`,
        {
          tier: resolvedTier,
          taskType,
          kind,
        },
      );
    }

    return this.normalizeResolvedModelKey(appId, kind, taskType, modelKey.trim());
  }

  createDefaultConfig(): AiNovelModelRoutingConfig {
    return structuredClone(DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG);
  }

  private normalizeResolvedModelKey(
    appId: string,
    kind: "chat" | "embedding",
    taskType: string,
    modelKey: string,
  ): string {
    if (
      appId === AI_NOVEL_APP_ID &&
      kind === "chat" &&
      taskType === "setup_turn" &&
      modelKey === "ainovel-free-reasoning"
    ) {
      return "ainovel-plus-reasoning";
    }
    return modelKey;
  }

  private parseStoredConfig(raw: string): AiNovelModelRoutingConfig {
    return this.validateInput(this.parseStoredJson(raw));
  }

  private parseStoredJson(raw: string): unknown {
    try {
      return JSON.parse(raw);
    } catch {
      throw new ApplicationError(500, "SYS_INTERNAL_ERROR", "Stored AI routing config is invalid.");
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
      badRequest("REQ_INVALID_BODY", "AI routing config must be a JSON object.");
    }

    const source = input as Record<string, unknown>;
    const defaultTier = this.normalizeTier(source.defaultTier);
    const tiersSource = source.tiers;
    if (!tiersSource || typeof tiersSource !== "object" || Array.isArray(tiersSource)) {
      badRequest("REQ_INVALID_BODY", "AI routing tiers must be a JSON object.");
    }

    const tiersRecord = tiersSource as Record<string, unknown>;
    const tiers = {
      free: this.normalizeTierConfig(tiersRecord.free, "free"),
      plus: this.normalizeTierConfig(tiersRecord.plus, "plus"),
      super_plus: this.normalizeTierConfig(tiersRecord.super_plus, "super_plus"),
    } satisfies Record<AiNovelModelRoutingTier, AiNovelTierRoutingConfig>;

    for (const key of Object.keys(tiersRecord)) {
      if (!VALID_TIERS.has(key as AiNovelModelRoutingTier)) {
        badRequest("REQ_INVALID_BODY", `Unsupported AI routing tier: ${key}.`);
      }
    }

    return {
      defaultTier,
      tiers,
    };
  }

  private normalizeTier(value: unknown): AiNovelModelRoutingTier {
    if (typeof value !== "string" || !VALID_TIERS.has(value as AiNovelModelRoutingTier)) {
      badRequest("REQ_INVALID_BODY", `defaultTier must be one of: ${[...VALID_TIERS].join(", ")}.`);
    }
    return value as AiNovelModelRoutingTier;
  }

  private normalizeTierConfig(value: unknown, tier: AiNovelModelRoutingTier): AiNovelTierRoutingConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `Tier ${tier} must be a JSON object.`);
    }

    const source = value as Record<string, unknown>;
    return {
      chat: this.normalizeTaskMap(source.chat, AI_NOVEL_CHAT_TASK_TYPES, `${tier}.chat`),
      embedding: this.normalizeTaskMap(source.embedding, AI_NOVEL_EMBEDDING_TASK_TYPES, `${tier}.embedding`),
    };
  }

  private normalizeTaskMap(
    value: unknown,
    taskTypes: readonly string[],
    fieldName: string,
  ): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `${fieldName} must be a JSON object.`);
    }

    const source = value as Record<string, unknown>;
    const normalized: Record<string, string> = {};

    for (const taskType of taskTypes) {
      const modelKey = source[taskType];
      if (typeof modelKey !== "string" || !modelKey.trim()) {
        badRequest("REQ_INVALID_BODY", `${fieldName}.${taskType} must be a non-empty string.`);
      }
      normalized[taskType] = modelKey.trim();
    }

    for (const key of Object.keys(source)) {
      if (!taskTypes.includes(key)) {
        badRequest("REQ_INVALID_BODY", `${fieldName} contains unsupported taskType: ${key}.`);
      }
    }

    return normalized;
  }

  private assertAiNovelAppId(appId: string): void {
    if (appId !== AI_NOVEL_APP_ID) {
      throw new ApplicationError(404, "APP_NOT_FOUND", `AI routing is not supported for app ${appId}.`);
    }
  }
}
