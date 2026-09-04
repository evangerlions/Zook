import type { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import type { LlmRoutingIdentity } from "../../services/llm-manager.ts";
import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import type { LlmModelHealthReader } from "../../services/llm-model-health.service.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import { ApplicationError, badRequest } from "../../shared/errors.ts";
import type {
  AiNovelChatModelOption,
  AiNovelModelSelectionConfig,
  AiNovelModelSelectionDocument,
  ConfigRevisionMeta,
  LlmServiceConfig,
} from "../../shared/types.ts";
import {
  AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
  createDefaultAiNovelModelSelectionConfig,
  normalizeAiNovelModelSelectionAdminInput,
  parseStoredAiNovelModelSelectionConfig,
} from "./ai-novel-model-selection-config.ts";
import { selectAiNovelChatModelKey } from "./ai-novel-model-weight-selection.ts";
import { buildAiNovelEffectiveModelWeights } from "./ai-novel-model-weight-selection.ts";
import { AI_NOVEL_APP_ID } from "./ai-novel-constants.ts";

export {
  AI_NOVEL_DEFAULT_CHAT_MODEL_KEY,
  AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
} from "./ai-novel-model-selection-config.ts";

export class AiNovelModelSelectionConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly modelHealthReader: LlmModelHealthReader,
    private readonly logger?: StructuredLogger,
  ) {}

  async getDocument(revision?: number): Promise<AiNovelModelSelectionDocument> {
    const revisions = await this.appConfigService.listRevisions(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
    );
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision
      ? await this.appConfigService.getRevision(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
          revision,
        )
      : await this.appConfigService.getLatestRevision(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
        );

    if (revision && !record) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AINovel model selection revision ${revision} was not found.`,
      );
    }

    const config = record
      ? parseStoredAiNovelModelSelectionConfig(record.content)
      : await this.getCurrentConfig();
    return this.createDocument(config, revisions, {
      updatedAt:
        record?.createdAt ??
        (await this.appConfigService.getUpdatedAt(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
        )),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
    });
  }

  async updateConfig(
    input: unknown,
    desc?: string,
  ): Promise<AiNovelModelSelectionDocument> {
    const config = normalizeAiNovelModelSelectionAdminInput(input);
    await this.assertConfiguredModels(config, "admin");
    await this.appConfigService.setValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
      JSON.stringify(config, null, 2),
      desc?.trim() || "ai-novel-model-selection-update",
    );
    return this.getDocument();
  }

  async restoreConfig(
    revision: number,
    desc?: string,
  ): Promise<AiNovelModelSelectionDocument> {
    const existing = await this.appConfigService.getRevision(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
      revision,
    );
    if (!existing) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AINovel model selection revision ${revision} was not found.`,
      );
    }

    const config = parseStoredAiNovelModelSelectionConfig(existing.content);
    await this.assertConfiguredModels(config, "admin");
    await this.appConfigService.restoreValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
      revision,
      desc?.trim() || `Restore AINovel model selection to R${revision}`,
    );
    return this.getDocument();
  }

  async getCurrentConfig(): Promise<AiNovelModelSelectionConfig> {
    const stored = await this.appConfigService.getValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
    );
    return stored
      ? parseStoredAiNovelModelSelectionConfig(stored)
      : this.createDefaultConfig();
  }

  async resolveChatModelKey(
    routingIdentity?: LlmRoutingIdentity,
  ): Promise<string> {
    const config = await this.getCurrentConfig();
    await this.assertConfiguredModels(config, "runtime");
    const llmConfig = await this.commonLlmConfigService.getCurrentConfig();
    if (!llmConfig.enabled) {
      return selectAiNovelChatModelKey(config, routingIdentity);
    }
    const health = await this.readModelHealth(config);
    if (
      health.size === config.chat.default.length &&
      buildAiNovelEffectiveModelWeights(config, health).every(
        (model) => model.effectiveWeight <= 0,
      )
    ) {
      throw new ApplicationError(
        503,
        "AI_MODEL_NOT_AVAILABLE",
        "No healthy AINovel model is available.",
      );
    }
    return selectAiNovelChatModelKey(config, routingIdentity, undefined, health);
  }

  createDefaultConfig(): AiNovelModelSelectionConfig {
    return createDefaultAiNovelModelSelectionConfig();
  }

  private async createDocument(
    config: AiNovelModelSelectionConfig,
    revisions: ConfigRevisionMeta[],
    meta: {
      updatedAt?: string;
      revision?: number;
      desc?: string;
      isLatest: boolean;
    },
  ): Promise<AiNovelModelSelectionDocument> {
    return {
      configKey: AI_NOVEL_MODEL_SELECTION_CONFIG_KEY,
      config,
      availableChatModels: await this.listAvailableChatModels(),
      updatedAt: meta.updatedAt,
      revision: meta.revision,
      desc: meta.desc,
      isLatest: meta.isLatest,
      revisions: [...revisions].reverse(),
    };
  }

  private async listAvailableChatModels(): Promise<AiNovelChatModelOption[]> {
    const config = await this.commonLlmConfigService.getCurrentConfig();
    const enabledProviders = new Set(
      config.providers
        .filter((provider) => provider.enabled)
        .map((provider) => provider.key),
    );
    return config.models
      .filter((model) => model.kind === "chat")
      .map((model) => ({
        key: model.key,
        label: model.label,
        configuredAvailable:
          config.enabled &&
          model.routes.some(
            (route) => route.enabled && enabledProviders.has(route.provider),
          ),
      }))
      .sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
  }

  private async readModelHealth(
    config: AiNovelModelSelectionConfig,
  ): Promise<Map<string, { available: boolean; healthScore: number }>> {
    const entries = await Promise.all(
      config.chat.default.map(async (model) => {
        try {
          return [
            model.modelKey,
            await this.modelHealthReader.getModelHealth(model.modelKey),
          ] as const;
        } catch (error) {
          // A failed health read is explicitly treated as unavailable for this
          // model only. Other models can still use their known health scores.
          this.logger?.warn("AINovel model health lookup failed; model marked unavailable", {
            modelKey: model.modelKey,
            error,
          });
          return [
            model.modelKey,
            { available: false, healthScore: 0 },
          ] as const;
        }
      }),
    );
    return new Map(entries);
  }

  private async assertConfiguredModels(
    selection: AiNovelModelSelectionConfig,
    mode: "admin" | "runtime",
  ): Promise<void> {
    const llmConfig = await this.commonLlmConfigService.getCurrentConfig();
    const modelKeys = new Set(selection.chat.default.map((item) => item.modelKey));
    for (const modelKey of modelKeys) {
      const model = llmConfig.models.find((item) => item.key === modelKey);
      if (!model || model.kind !== "chat") {
        this.invalidModel(modelKey, llmConfig, mode);
      }
    }
  }

  private invalidModel(
    modelKey: string,
    llmConfig: LlmServiceConfig,
    mode: "admin" | "runtime",
  ): never {
    const model = llmConfig.models.find((item) => item.key === modelKey);
    const message = model
      ? `AINovel model ${modelKey} must be configured as a chat model.`
      : `AINovel model ${modelKey} does not exist in common.llm_service.`;
    if (mode === "admin") {
      badRequest("ADMIN_AINOVEL_MODEL_SELECTION_INVALID", message);
    }
    throw new ApplicationError(502, "AI_UPSTREAM_CONFIG_INVALID", message, {
      modelKey,
    });
  }
}
