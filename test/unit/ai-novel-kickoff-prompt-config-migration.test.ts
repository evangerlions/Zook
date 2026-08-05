import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { defaultAiNovelKickoffRecommendedPrompts } from "../../src/modules/ai-novel/ai-novel-kickoff-prompt-defaults.ts";
import { normalizeAiNovelKickoffPromptConfig } from "../../src/modules/ai-novel/ai-novel-kickoff-prompt-config-migration.ts";
import { createApplication } from "../support/create-test-application.ts";

test("backfills a persisted legacy config and keeps zh-CN compatible", () => {
  const result = JSON.parse(normalizeAiNovelKickoffPromptConfig(JSON.stringify({
    app: "ai_novel", kickoff: { recommendedPrompts: ["旧中文提示"] },
  }))!);
  assert.deepEqual(result.kickoff.recommendedPrompts, ["旧中文提示"]);
  assert.deepEqual(result.kickoff.recommendedPromptsI18n["zh-CN"], ["旧中文提示"]);
  assert.equal(Object.keys(result.kickoff.recommendedPromptsI18n).length, 20);
});

test("backfills managed-state config without overwriting valid custom locales", () => {
  const result = JSON.parse(normalizeAiNovelKickoffPromptConfig(JSON.stringify({
    app: "ai_novel",
    kickoff: {
      recommendedPrompts: ["保留的中文提示"],
      recommendedPromptsI18n: {
        "zh-CN": ["自定义中文候选"],
        "ja-JP": ["カスタム候補"],
        "fr-FR": [""],
        "xx-XX": ["unsupported"],
      },
    },
  }))!);
  assert.deepEqual(result.kickoff.recommendedPromptsI18n["ja-JP"], ["カスタム候補"]);
  assert.deepEqual(result.kickoff.recommendedPromptsI18n["zh-CN"], ["自定义中文候选"]);
  assert.deepEqual(result.kickoff.recommendedPrompts, ["保留的中文提示"]);
  assert.notDeepEqual(result.kickoff.recommendedPromptsI18n["fr-FR"], [""]);
  assert.equal("xx-XX" in result.kickoff.recommendedPromptsI18n, false);
});

test("backfills a kickoff section that has neither prompt field", () => {
  const result = JSON.parse(normalizeAiNovelKickoffPromptConfig(JSON.stringify({
    app: "ai_novel", kickoff: {},
  }))!);
  assert.equal(Object.keys(result.kickoff.recommendedPromptsI18n).length, 20);
  assert.deepEqual(
    result.kickoff.recommendedPrompts,
    result.kickoff.recommendedPromptsI18n["zh-CN"],
  );
});

test("adds kickoff prompts to a sparse persisted AINovel config", () => {
  const result = JSON.parse(normalizeAiNovelKickoffPromptConfig(JSON.stringify({
    app: "ai_novel",
  }))!);
  assert.equal(Object.keys(result.kickoff.recommendedPromptsI18n).length, 20);
  assert.deepEqual(
    result.kickoff.recommendedPrompts,
    result.kickoff.recommendedPromptsI18n["zh-CN"],
  );
});

test("factory migrates persisted legacy prompts before serving public config", async () => {
  const seed = buildDefaultSeed();
  const legacyPrompts = ["启动前保留的中文提示"];
  const config = seed.appConfigs!.find(
    (item) => item.id === "cfg_ai_novel_delivery_config",
  )!;
  config.configValue = JSON.stringify({
    app: "ai_novel",
    kickoff: { recommendedPrompts: legacyPrompts },
  });

  const runtime = await createApplication({ seed });
  const response = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/ai_novel/public/config",
    headers: { "x-app-id": "ai_novel" },
  });
  assert.equal(response.statusCode, 200);
  const kickoff = response.body.data.config.kickoff as {
    recommendedPrompts: string[];
    recommendedPromptsI18n: Record<string, string[]>;
  };
  assert.deepEqual(kickoff.recommendedPrompts, legacyPrompts);
  assert.deepEqual(kickoff.recommendedPromptsI18n["zh-CN"], legacyPrompts);
  assert.deepEqual(
    Object.keys(kickoff.recommendedPromptsI18n).sort(),
    Object.keys(defaultAiNovelKickoffRecommendedPrompts).sort(),
  );
  const revisions = await runtime.services.appConfigService.listRevisions(
    "ai_novel",
    "admin.delivery_config",
  );
  assert.equal(revisions.at(-1)?.desc, "backfill localized AINovel kickoff prompts");
  await runtime.close();
});
