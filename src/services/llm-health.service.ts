import { KVManager } from "../infrastructure/kv/kv-manager.ts";
import type {
  LlmModelConfig,
  LlmModelRuntimeStatus,
  LlmRouteRuntimeStatus,
  LlmRoutingStrategy,
} from "../shared/types.ts";

const HEALTH_SCOPE = "llm-health-window";
const HEALTH_LOCK_PREFIX = "lock";
const HEALTH_LOCK_TTL_SECONDS = 5;
const HEALTH_LOCK_ATTEMPTS = 6;
const HEALTH_LOCK_BACKOFF_MS = 40;
const HEALTH_RECENT_LIMIT = 100;
const HEALTH_MIN_CALLS = 10;

interface LlmHealthWindowSample {
  ok: boolean;
  timestamp: string;
  firstByteLatencyMs: number;
  totalLatencyMs: number;
}

interface LlmHealthWindowRecord {
  totalCalls: number;
  recent: LlmHealthWindowSample[];
  lastErrorAt?: string;
  updatedAt: string;
}

export interface LlmRouteRef {
  modelKey: string;
  provider: string;
  providerModel: string;
}

export interface LlmRouteHealthSnapshot {
  totalCalls: number;
  sampleSize: number;
  successRate: number;
  healthScore: number;
  lastErrorAt?: string;
}

export class LlmHealthService {
  constructor(private readonly kvManager: KVManager) {}

  async recordResult(
    route: LlmRouteRef,
    result: {
      ok: boolean;
      timestamp?: string;
      firstByteLatencyMs: number;
      totalLatencyMs: number;
    },
  ): Promise<void> {
    const key = this.buildKey(route);
    await this.withRouteLock(key, async () => {
      const current =
        (await this.kvManager.getJson<LlmHealthWindowRecord>(HEALTH_SCOPE, key)) ?? {
          totalCalls: 0,
          recent: [],
          updatedAt: new Date().toISOString(),
        };

      const timestamp = result.timestamp ?? new Date().toISOString();
      const next: LlmHealthWindowRecord = {
        totalCalls: current.totalCalls + 1,
        recent: [
          ...current.recent,
          {
            ok: result.ok,
            timestamp,
            firstByteLatencyMs: Math.max(0, Math.round(result.firstByteLatencyMs)),
            totalLatencyMs: Math.max(0, Math.round(result.totalLatencyMs)),
          },
        ].slice(-HEALTH_RECENT_LIMIT),
        lastErrorAt: result.ok ? current.lastErrorAt : timestamp,
        updatedAt: timestamp,
      };

      await this.kvManager.setJson(HEALTH_SCOPE, key, next);
    });
  }

  async getRouteSnapshot(route: LlmRouteRef): Promise<LlmRouteHealthSnapshot> {
    const record = await this.kvManager.getJson<LlmHealthWindowRecord>(HEALTH_SCOPE, this.buildKey(route));
    if (!record) {
      return {
        totalCalls: 0,
        sampleSize: 0,
        successRate: 100,
        healthScore: 100,
      };
    }

    const sampleSize = Math.min(record.recent.length, HEALTH_RECENT_LIMIT);
    const successCount = record.recent.filter((item) => item.ok).length;
    const successRate = sampleSize ? roundTwoDecimals((successCount / sampleSize) * 100) : 100;
    const healthScore = record.totalCalls < HEALTH_MIN_CALLS ? 100 : successRate;

    return {
      totalCalls: record.totalCalls,
      sampleSize,
      successRate,
      healthScore,
      lastErrorAt: record.lastErrorAt,
    };
  }

  async buildModelRuntimeStatus(model: LlmModelConfig): Promise<LlmModelRuntimeStatus> {
    const routeStatuses = await Promise.all(
      model.routes.map(async (route) => {
        const snapshot = await this.getRouteSnapshot({
          modelKey: model.key,
          provider: route.provider,
          providerModel: route.providerModel,
        });
        return {
          provider: route.provider,
          providerModel: route.providerModel,
          enabled: route.enabled,
          weight: route.weight,
          totalCalls: snapshot.totalCalls,
          sampleSize: snapshot.sampleSize,
          successRate: snapshot.successRate,
          healthScore: snapshot.healthScore,
          lastErrorAt: snapshot.lastErrorAt,
        } satisfies Omit<LlmRouteRuntimeStatus, "effectiveProbability">;
      }),
    );

    return {
      key: model.key,
      kind: model.kind,
      strategy: model.strategy,
      routes: this.attachEffectiveProbabilities(model.strategy, routeStatuses),
    };
  }

  private attachEffectiveProbabilities(
    strategy: LlmRoutingStrategy,
    routes: Array<Omit<LlmRouteRuntimeStatus, "effectiveProbability">>,
  ): LlmRouteRuntimeStatus[] {
    if (strategy === "fixed") {
      const chosenIndex = routes.reduce((bestIndex, route, index, items) => {
        if (!route.enabled) {
          return bestIndex;
        }

        if (bestIndex === -1) {
          return index;
        }

        return route.weight > items[bestIndex].weight ? index : bestIndex;
      }, -1);

      const fallbackIndex = chosenIndex >= 0 ? chosenIndex : routes.length ? 0 : -1;

      return routes.map((route, index) => ({
        ...route,
        effectiveProbability: fallbackIndex === index ? 100 : 0,
      }));
    }

    const enabledRoutes = routes.filter((item) => item.enabled);
    const effectiveScores = enabledRoutes.map((item) => item.weight * (item.healthScore / 100));
    const totalEffective = effectiveScores.reduce((sum, item) => sum + item, 0);
    const totalWeight = enabledRoutes.reduce((sum, item) => sum + item.weight, 0);

    return routes.map((route) => {
      if (!route.enabled) {
        return {
          ...route,
          effectiveProbability: 0,
        };
      }

      const enabledIndex = enabledRoutes.findIndex(
        (item) => item.provider === route.provider && item.providerModel === route.providerModel,
      );
      const base = effectiveScores[enabledIndex] ?? 0;
      const effectiveProbability =
        totalEffective > 0
          ? roundTwoDecimals((base / totalEffective) * 100)
          : totalWeight > 0
            ? roundTwoDecimals((route.weight / totalWeight) * 100)
            : 0;

      return {
        ...route,
        effectiveProbability,
      };
    });
  }

  private buildKey(route: LlmRouteRef): string {
    return `${route.modelKey}::${route.provider}::${route.providerModel}`;
  }

  private async withRouteLock<TValue>(routeKey: string, action: () => Promise<TValue>): Promise<TValue> {
    const lockKey = `${HEALTH_LOCK_PREFIX}:${routeKey}`;
    const lockToken = `${routeKey}:${Date.now()}:${Math.random()}`;

    for (let attempt = 0; attempt < HEALTH_LOCK_ATTEMPTS; attempt += 1) {
      const acquired = await this.kvManager.setIfNotExists(
        HEALTH_SCOPE,
        lockKey,
        lockToken,
        HEALTH_LOCK_TTL_SECONDS,
      );
      if (acquired) {
        try {
          return await action();
        } finally {
          await this.releaseLock(lockKey, lockToken);
        }
      }
      await this.sleep(HEALTH_LOCK_BACKOFF_MS * (attempt + 1));
    }

    throw new Error(`LLM health record is busy for ${routeKey}.`);
  }

  private async releaseLock(lockKey: string, lockToken: string): Promise<void> {
    const current = await this.kvManager.getString(HEALTH_SCOPE, lockKey);
    if (current === lockToken) {
      await this.kvManager.delete(HEALTH_SCOPE, lockKey);
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

function roundTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}
