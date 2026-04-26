import { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import { ApplicationError, badRequest } from "../shared/errors.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
  AiNovelModelRoutingConfig,
  AiNovelModelRoutingTier,
  AiNovelTierRoutingConfig,
} from "../shared/types.ts";
import {
  AI_NOVEL_CHAT_TASK_TYPES,
  AI_NOVEL_EMBEDDING_TASK_TYPES,
} from "../modules/ai-novel/ai-novel-llm-scenes.ts";

export const AI_NOVEL_APP_ID = "ai_novel";
export const AI_NOVEL_MODEL_ROUTING_CONFIG_KEY = "ai_novel.model_routing";

const VALID_TIERS = new Set<AiNovelModelRoutingTier>([
  "free",
  "plus",
  "super_plus",
]);
const ADDITIVE_STORED_CHAT_TASK_TYPES = [
  "write_turn",
  "chapter_draft",
  "chapter_summary",
  "future_instruction_cleanup",
  "main_line_review",
  "snapshot_generation",
  "next_chapter_brief",
] as const;

const DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG: AiNovelModelRoutingConfig = {
  defaultTier: "free",
  tiers: {
    free: {
      chat: {
        kickoff_turn: "ainovel-plus-reasoning",
        write_turn: "ainovel-free-creative",
        chapter_draft: "ainovel-free-creative",
        chapter_summary: "ainovel-lowcost-structured",
        future_instruction_cleanup: "ainovel-lowcost-structured",
        main_line_review: "ainovel-free-reasoning",
        snapshot_generation: "ainovel-lowcost-structured",
        next_chapter_brief: "ainovel-lowcost-structured",
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
        kickoff_turn: "ainovel-plus-reasoning",
        write_turn: "ainovel-plus-creative",
        chapter_draft: "ainovel-plus-creative",
        chapter_summary: "ainovel-lowcost-structured",
        future_instruction_cleanup: "ainovel-lowcost-structured",
        main_line_review: "ainovel-plus-reasoning",
        snapshot_generation: "ainovel-lowcost-structured",
        next_chapter_brief: "ainovel-lowcost-structured",
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
        kickoff_turn: "ainovel-super-reasoning",
        write_turn: "ainovel-super-creative",
        chapter_draft: "ainovel-super-creative",
        chapter_summary: "ainovel-lowcost-structured",
        future_instruction_cleanup: "ainovel-lowcost-structured",
        main_line_review: "ainovel-super-reasoning",
        snapshot_generation: "ainovel-lowcost-structured",
        next_chapter_brief: "ainovel-lowcost-structured",
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

    return this.normalizeResolvedModelKey(
      appId,
      kind,
      taskType,
      modelKey.trim(),
    );
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
      taskType === "kickoff_turn" &&
      modelKey === "ainovel-free-reasoning"
    ) {
      return "ainovel-plus-reasoning";
    }
    return modelKey;
  }

  private parseStoredConfig(raw: string): AiNovelModelRoutingConfig {
    return this.validateInput(
      this.normalizeStoredConfig(this.parseStoredJson(raw)),
    );
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

  private normalizeStoredConfig(input: unknown): unknown {
    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return input;
    }

    const source = structuredClone(input as Record<string, unknown>);
    const tiers = source.tiers;
    if (!tiers || typeof tiers !== "object" || Array.isArray(tiers)) {
      return source;
    }

    for (const [tierName, tierValue] of Object.entries(
      tiers as Record<string, unknown>,
    )) {
      if (
        !tierValue ||
        typeof tierValue !== "object" ||
        Array.isArray(tierValue)
      ) {
        continue;
      }
      const chat = (tierValue as Record<string, unknown>).chat;
      if (!chat || typeof chat !== "object" || Array.isArray(chat)) {
        continue;
      }
      const chatRecord = chat as Record<string, unknown>;
      if (
        typeof chatRecord.setup_turn === "string" &&
        (!("kickoff_turn" in chatRecord) ||
          typeof chatRecord.kickoff_turn !== "string" ||
          !chatRecord.kickoff_turn.trim())
      ) {
        chatRecord.kickoff_turn = chatRecord.setup_turn;
      }
      delete chatRecord.setup_turn;
      if (!VALID_TIERS.has(tierName as AiNovelModelRoutingTier)) {
        continue;
      }
      const defaultChat =
        DEFAULT_AI_NOVEL_MODEL_ROUTING_CONFIG.tiers[
          tierName as AiNovelModelRoutingTier
        ].chat;
      for (const taskType of ADDITIVE_STORED_CHAT_TASK_TYPES) {
        const modelKey = chatRecord[taskType];
        if (typeof modelKey !== "string" || !modelKey.trim()) {
          chatRecord[taskType] = defaultChat[taskType];
        }
      }
    }

    return source;
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
    const tiersSource = source.tiers;
    if (
      !tiersSource ||
      typeof tiersSource !== "object" ||
      Array.isArray(tiersSource)
    ) {
      badRequest("REQ_INVALID_BODY", "AI routing tiers must be a JSON object.");
    }

    const tiersRecord = tiersSource as Record<string, unknown>;
    const tiers = {
      free: this.normalizeTierConfig(tiersRecord.free, "free"),
      plus: this.normalizeTierConfig(tiersRecord.plus, "plus"),
      super_plus: this.normalizeTierConfig(
        tiersRecord.super_plus,
        "super_plus",
      ),
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

  private normalizeTierConfig(
    value: unknown,
    tier: AiNovelModelRoutingTier,
  ): AiNovelTierRoutingConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      badRequest("REQ_INVALID_BODY", `Tier ${tier} must be a JSON object.`);
    }

    const source = value as Record<string, unknown>;
    return {
      chat: this.normalizeTaskMap(
        source.chat,
        AI_NOVEL_CHAT_TASK_TYPES,
        `${tier}.chat`,
      ),
      embedding: this.normalizeTaskMap(
        source.embedding,
        AI_NOVEL_EMBEDDING_TASK_TYPES,
        `${tier}.embedding`,
      ),
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
        badRequest(
          "REQ_INVALID_BODY",
          `${fieldName}.${taskType} must be a non-empty string.`,
        );
      }
      normalized[taskType] = modelKey.trim();
    }

    for (const key of Object.keys(source)) {
      if (!taskTypes.includes(key)) {
        badRequest(
          "REQ_INVALID_BODY",
          `${fieldName} contains unsupported taskType: ${key}.`,
        );
      }
    }

    return normalized;
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
