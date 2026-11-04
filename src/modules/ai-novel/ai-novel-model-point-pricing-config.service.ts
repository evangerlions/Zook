import type { CommonLlmConfigService } from "../../services/common-llm-config.service.ts";
import type { StructuredLogger } from "../../infrastructure/logging/pino-logger.module.ts";
import type { VersionedAppConfigService } from "../../services/versioned-app-config.service.ts";
import { ApplicationError } from "../../shared/errors.ts";
import type {
  AiNovelModelPointPricingConfig,
  AiNovelModelPointPricingDocument,
  AiNovelPointPricingModelOption,
  ConfigRevisionMeta,
  LlmPointPricing,
} from "../../shared/types.ts";
import { AI_NOVEL_APP_ID } from "./ai-novel-constants.ts";
import {
  AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
  createDefaultAiNovelPointPricingConfig,
  getAiNovelPointPricingReference,
  normalizeAiNovelModelPointPricingAdminInput,
  parseStoredAiNovelModelPointPricingConfig,
} from "./ai-novel-model-point-pricing-config.ts";

export class AiNovelModelPointPricingConfigService {
  constructor(
    private readonly appConfigService: VersionedAppConfigService,
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly logger?: StructuredLogger,
  ) {}

  async getDocument(revision?: number): Promise<AiNovelModelPointPricingDocument> {
    const revisions = await this.appConfigService.listRevisions(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
    );
    const latestRevision = revisions.at(-1)?.revision;
    const record = revision !== undefined
      ? await this.appConfigService.getRevision(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
          revision,
        )
      : await this.appConfigService.getLatestRevision(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
        );
    if (revision !== undefined && !record) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AINovel model point pricing revision ${revision} was not found.`,
      );
    }

    const config = record
      ? parseStoredAiNovelModelPointPricingConfig(record.content)
      : await this.getCurrentConfig();
    return this.createDocument(config, revisions, {
      updatedAt:
        record?.createdAt ??
        (await this.appConfigService.getUpdatedAt(
          AI_NOVEL_APP_ID,
          AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
        )),
      revision: record?.revision,
      desc: record?.desc,
      isLatest: !record || record.revision === latestRevision,
    });
  }

  async updateConfig(
    input: unknown,
    desc?: string,
  ): Promise<AiNovelModelPointPricingDocument> {
    const config = normalizeAiNovelModelPointPricingAdminInput(input);
    await this.appConfigService.setValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      JSON.stringify(config, null, 2),
      desc?.trim() || "ai-novel-model-point-pricing-update",
    );
    const document = await this.getDocument();
    this.logger?.info("AINovel model point pricing configuration updated", {
      configKey: AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      revision: document.revision,
      modelCount: config.models.length,
      pricedModelCount: config.models.filter((item) =>
        item.inputPointsPerMillionTokens !== undefined
      ).length,
    });
    return document;
  }

  async restoreConfig(
    revision: number,
    desc?: string,
  ): Promise<AiNovelModelPointPricingDocument> {
    const existing = await this.appConfigService.getRevision(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      revision,
    );
    if (!existing) {
      throw new ApplicationError(
        404,
        "REQ_INVALID_QUERY",
        `AINovel model point pricing revision ${revision} was not found.`,
      );
    }
    parseStoredAiNovelModelPointPricingConfig(existing.content);
    await this.appConfigService.restoreValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      revision,
      desc?.trim() || `Restore AINovel model point pricing to R${revision}`,
    );
    const document = await this.getDocument();
    this.logger?.info("AINovel model point pricing configuration restored", {
      configKey: AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      sourceRevision: revision,
      revision: document.revision,
    });
    return document;
  }

  async getCurrentConfig(): Promise<AiNovelModelPointPricingConfig> {
    const stored = await this.appConfigService.getValue(
      AI_NOVEL_APP_ID,
      AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
    );
    return stored
      ? parseStoredAiNovelModelPointPricingConfig(stored)
      : createDefaultAiNovelPointPricingConfig();
  }

  async resolveModelPointPricing(
    appId: string | undefined,
    modelKey: string,
  ): Promise<LlmPointPricing | undefined> {
    if (appId !== AI_NOVEL_APP_ID) return undefined;
    const config = await this.getCurrentConfig();
    const model = config.models.find((item) => item.modelKey === modelKey);
    if (
      model?.inputPointsPerMillionTokens === undefined ||
      model.outputPointsPerMillionTokens === undefined
    ) {
      return undefined;
    }
    return {
      inputPointsPerMillionTokens: model.inputPointsPerMillionTokens,
      outputPointsPerMillionTokens: model.outputPointsPerMillionTokens,
      ...(model.contextTiers ? { contextTiers: model.contextTiers } : {}),
      ...(model.cachedInputPointsPerMillionTokens === undefined ? {} : { cachedInputPointsPerMillionTokens: model.cachedInputPointsPerMillionTokens }),
    };
  }

  createDefaultConfig(): AiNovelModelPointPricingConfig {
    return createDefaultAiNovelPointPricingConfig();
  }

  private async createDocument(
    config: AiNovelModelPointPricingConfig,
    revisions: ConfigRevisionMeta[],
    meta: {
      updatedAt?: string;
      revision?: number;
      desc?: string;
      isLatest: boolean;
    },
  ): Promise<AiNovelModelPointPricingDocument> {
    return {
      configKey: AI_NOVEL_MODEL_POINT_PRICING_CONFIG_KEY,
      config,
      availableModels: await this.listAvailableModels(config),
      updatedAt: meta.updatedAt,
      revision: meta.revision,
      desc: meta.desc,
      isLatest: meta.isLatest,
      revisions: [...revisions].reverse(),
    };
  }

  private async listAvailableModels(
    config: AiNovelModelPointPricingConfig,
  ): Promise<AiNovelPointPricingModelOption[]> {
    const common = await this.commonLlmConfigService.getCurrentConfig();
    const enabledProviders = new Set(
      common.providers.filter((item) => item.enabled).map((item) => item.key),
    );
    const models = new Map<string, AiNovelPointPricingModelOption>();

    for (const model of common.models) {
      models.set(model.key, {
        key: model.key,
        label: model.label,
        kind: model.kind,
        configuredAvailable:
          common.enabled &&
          model.routes.some((route) =>
            route.enabled && enabledProviders.has(route.provider)
          ),
        reference: getAiNovelPointPricingReference(model.key),
      });
    }

    for (const model of config.models) {
      if (!models.has(model.modelKey)) {
        models.set(model.modelKey, {
          key: model.modelKey,
          label: model.modelKey,
          kind: "chat",
          configuredAvailable: false,
          reference: getAiNovelPointPricingReference(model.modelKey),
        });
      }
    }

    return [...models.values()].sort((left, right) =>
      left.label.localeCompare(right.label, "zh-CN")
    );
  }
}
