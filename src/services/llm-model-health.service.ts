import type { CommonLlmConfigService } from "./common-llm-config.service.ts";
import { LlmHealthService, type LlmModelHealthSnapshot } from "./llm-health.service.ts";

export interface LlmModelHealthReader {
  getModelHealth(modelKey: string): Promise<LlmModelHealthSnapshot>;
}

export class LlmModelHealthService implements LlmModelHealthReader {
  private static readonly CACHE_TTL_MS = 2_000;
  private readonly cache = new Map<string, { expiresAt: number; snapshot: LlmModelHealthSnapshot }>();
  private readonly pending = new Map<string, Promise<LlmModelHealthSnapshot>>();

  constructor(
    private readonly commonLlmConfigService: CommonLlmConfigService,
    private readonly llmHealthService: LlmHealthService,
  ) {}

  async getModelHealth(modelKey: string): Promise<LlmModelHealthSnapshot> {
    const cached = this.cache.get(modelKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.snapshot;
    }
    const existing = this.pending.get(modelKey);
    if (existing) return existing;
    const pending = this.loadModelHealth(modelKey);
    this.pending.set(modelKey, pending);
    try {
      return await pending;
    } finally {
      this.pending.delete(modelKey);
    }
  }

  private async loadModelHealth(modelKey: string): Promise<LlmModelHealthSnapshot> {
    const config = await this.commonLlmConfigService.getCurrentConfig();
    if (!config.enabled) {
      return this.cacheSnapshot({
        modelKey,
        available: false,
        healthScore: 0,
        sampleSize: 0,
      });
    }
    const model = config.models.find((item) => item.key === modelKey);
    if (!model || model.kind !== "chat") {
      return this.cacheSnapshot({
        modelKey,
        available: false,
        healthScore: 0,
        sampleSize: 0,
      });
    }
    const snapshot = await this.llmHealthService.getModelHealth(model, config.providers);
    return this.cacheSnapshot(snapshot);
  }

  private cacheSnapshot(snapshot: LlmModelHealthSnapshot): LlmModelHealthSnapshot {
    this.cache.set(snapshot.modelKey, {
      expiresAt: Date.now() + LlmModelHealthService.CACHE_TTL_MS,
      snapshot,
    });
    return snapshot;
  }
}
