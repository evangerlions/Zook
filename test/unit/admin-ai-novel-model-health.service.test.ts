import assert from "node:assert/strict";
import test from "node:test";

import { AdminAiNovelModelHealthService } from "../../src/modules/admin/admin-ai-novel-model-health.service.ts";
import type { AiNovelModelSelectionConfig } from "../../src/shared/types.ts";

const selection: AiNovelModelSelectionConfig = {
  schemaVersion: 1,
  chat: {
    default: [
      { modelKey: "model-a", weight: 50 },
      { modelKey: "model-b", weight: 50 },
    ],
  },
};

test("admin model health keeps configuration available when metrics query fails", async () => {
  const service = new AdminAiNovelModelHealthService(
    {
      async getRoutingModelRequestCounts() {
        throw new Error("metrics backend unavailable");
      },
    } as never,
    {
      async getModelHealth(modelKey: string) {
        return {
          modelKey,
          available: true,
          healthScore: 100,
          sampleSize: 1,
        };
      },
    } as never,
  );

  const result = await service.getModelHealth(selection);
  assert.deepEqual(
    result.map(({ modelKey, actualHitRate, healthScore }) => ({
      modelKey,
      actualHitRate,
      healthScore,
    })),
    [
      { modelKey: "model-a", actualHitRate: 0, healthScore: 100 },
      { modelKey: "model-b", actualHitRate: 0, healthScore: 100 },
    ],
  );
});
