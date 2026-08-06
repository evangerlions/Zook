import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";

const SUPPORTED_KICKOFF_LOCALES = [
  "en-US",
  "zh-CN",
  "zh-TW",
  "ja-JP",
  "es-ES",
  "pt-BR",
  "ko-KR",
  "de-DE",
  "fr-FR",
  "hi-IN",
  "id-ID",
  "it-IT",
  "tr-TR",
  "vi-VN",
  "th-TH",
  "pl-PL",
  "nl-NL",
  "sv-SE",
  "bn-BD",
  "sw-KE",
] as const;

const REVIEWED_JAPANESE_KICKOFF_PROMPTS = [
  "宗門を追放された主人公の成長譚を書こう。",
  "静かな熱を秘めた転生復讐譚を書こう。",
  "テンポよく読める長編の現代異能ものを考えよう。",
  "緊迫したルールホラーの謎解きを書こう。",
  "意外なSF的ひねりのある、軽やかな日常譚を書こう。",
  "全員に成長の見せ場がある群像冒険譚を作ろう。",
  "静かな熱と緻密な策謀が光る歴史復讐譚を書こう。",
  "疾走感のあるサイバーパンク現代異能譚を書こう。",
  "ひとつの異変から始まる学園怪異譚を書こう。",
  "冒頭から危機が迫る終末サバイバル成長譚を書こう。",
] as const;

test("AINovel public config remains locale-neutral and carries every prompt list", async () => {
  const runtime = await createApplication();
  const request = (locale: string) =>
    runtime.app.handle({
      method: "GET",
      path: "/api/v1/ai_novel/public/config",
      headers: {
        "x-app-id": "ai_novel",
        "x-app-locale": locale,
      },
    });

  const [chineseResponse, japaneseResponse] = await Promise.all([
    request("zh-CN"),
    request("ja-JP"),
  ]);

  assert.equal(chineseResponse.statusCode, 200);
  assert.equal(japaneseResponse.statusCode, 200);
  assert.deepEqual(chineseResponse.body.data.config, japaneseResponse.body.data.config);

  const kickoff = chineseResponse.body.data.config.kickoff as {
    recommendedPrompts: string[];
    recommendedPromptsI18n: Record<string, string[]>;
  };
  const localizedPrompts = kickoff.recommendedPromptsI18n;
  assert.deepEqual(
    Object.keys(localizedPrompts).sort(),
    [...SUPPORTED_KICKOFF_LOCALES].sort(),
  );
  for (const locale of SUPPORTED_KICKOFF_LOCALES) {
    const prompts = localizedPrompts[locale];
    assert.ok(Array.isArray(prompts));
    assert.ok(prompts.length >= 10);
    assert.ok(prompts.every((prompt) => prompt.trim().length > 0));
  }
  assert.deepEqual(kickoff.recommendedPrompts, localizedPrompts["zh-CN"]);
  assert.deepEqual(
    localizedPrompts["ja-JP"],
    REVIEWED_JAPANESE_KICKOFF_PROMPTS,
  );
  assert.notDeepEqual(localizedPrompts["ja-JP"], localizedPrompts["zh-CN"]);
});

test("AINovel public config only accepts supported locale prompt lists", () => {
  const valid = PublicContractValidator.validatePublicConfigData({
    appId: "ai_novel",
    config: {
      kickoff: {
        recommendedPromptsI18n: {
          "ja-JP": ["自然な日本語のおすすめ"],
        },
      },
    },
  });
  assert.equal(valid.ok, true);

  const unknownLocale = PublicContractValidator.validatePublicConfigData({
    appId: "ai_novel",
    config: {
      kickoff: {
        recommendedPromptsI18n: {
          ja: ["unsupported locale key"],
        },
      },
    },
  });
  assert.equal(unknownLocale.ok, false);

  const malformedPrompt = PublicContractValidator.validatePublicConfigData({
    appId: "ai_novel",
    config: {
      kickoff: {
        recommendedPromptsI18n: {
          "ja-JP": ["valid", 42],
        },
      },
    },
  });
  assert.equal(malformedPrompt.ok, false);
});
