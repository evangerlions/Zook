import assert from "node:assert/strict";
import test from "node:test";

import {
  aiNovelModelHealthColor,
  aiNovelModelHealthTone,
} from "../../apps/admin-web/app/lib/ai-novel-model-health.ts";
import { AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES } from "../../apps/admin-web/app/lib/ai-novel-model-health-table.ts";

test("AINovel model health maps scores to stable UI tones", () => {
  assert.equal(aiNovelModelHealthTone(100), "healthy");
  assert.equal(aiNovelModelHealthColor(100), "success");
  assert.equal(aiNovelModelHealthTone(94.99), "warning");
  assert.equal(aiNovelModelHealthColor(80), "warning");
  assert.equal(aiNovelModelHealthTone(79.99), "critical");
  assert.equal(aiNovelModelHealthColor(0), "error");
});

test("AINovel model health table exposes the routing fields", () => {
  assert.deepEqual(AI_NOVEL_MODEL_HEALTH_COLUMN_TITLES, [
    "模型 Key",
    "配置权重",
    "健康调整权重",
    "实际命中率",
    "成功率",
    "健康分",
    "样本",
    "状态",
  ]);
});
