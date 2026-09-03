import { ApplicationError } from "../shared/errors.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import type { VersionedAppConfigService } from "./versioned-app-config.service.ts";
import type {
  AdminAiRoutingDocument,
  AdminAppSummary,
} from "../shared/types.ts";

export const LIGHTTICK_APP_ID = "lighttick";
export const LIGHTTICK_AI_ROUTING_CONFIG_KEY = "lighttick.ai_routing";

type LightTickSceneOverride = { modelAlias: string; timeoutMs: number; maxContextTokens: number;
  maxOutputTokens: number; maxEstimatedCostUsd: number; fallback: string };
type LightTickAiRoutingConfig = { scenes: Record<LightTickAiSceneName, LightTickSceneOverride> };

export class AppAiRoutingConfigService {
  constructor(private readonly appConfigService?: VersionedAppConfigService) {}

  async getDocument(
    app: AdminAppSummary,
    revision?: number,
  ): Promise<AdminAiRoutingDocument> {
    this.assertLightTickAppId(app.appId);
    return this.getLightTickDocument(app, revision);
  }

  async updateConfig(
    appId: string,
    rawJson: string,
    desc?: string,
  ): Promise<void> {
    this.assertLightTickAppId(appId);
    const config = this.parseLightTickConfig(rawJson);
    await this.requireVersionedConfig().setValue(appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY,
      JSON.stringify(config, null, 2), desc?.trim() || "Update LightTick AI routing");
  }

  async restoreConfig(
    appId: string,
    revision: number,
    desc?: string,
  ): Promise<void> {
    this.assertLightTickAppId(appId);
    await this.requireVersionedConfig().restoreValue(appId, LIGHTTICK_AI_ROUTING_CONFIG_KEY, revision,
      desc?.trim() || `Restore LightTick AI routing to R${revision}`);
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

  private assertLightTickAppId(appId: string): void {
    if (appId !== LIGHTTICK_APP_ID) {
      throw new ApplicationError(
        404,
        "APP_NOT_FOUND",
        `AI routing is not supported for app ${appId}.`,
      );
    }
  }
}
