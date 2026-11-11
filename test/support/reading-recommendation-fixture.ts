import {
  ReadingPreferencesService,
  defaultReadingPreferences,
} from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import { ReadingRecommendationService } from "../../src/modules/lighttick/reading/reading-recommendation.service.ts";
import type { ReadingWorkService } from "../../src/modules/lighttick/reading/reading-work.service.ts";
import type { LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
export async function seedReadingRecommendation(
  work: ReadingWorkService,
  owner: LightTickOwner,
  count = 8,
) {
  await work.saveSource(
    owner,
    "source-batch-fixture",
    {
      base_revision: 0,
      title: "Fixture publisher",
      url: "https://example.com/feed",
      format: "rss",
      archived: false,
      language: "en",
      topics: ["\u8ba4\u77e5"],
      domains: ["example.com"],
    },
    "batch-fixture-source",
  );
  await new ReadingPreferencesService(work).save(
    owner,
    {
      base_revision: 0,
      value: {
        ...defaultReadingPreferences().value,
        count,
        mode: "recent",
        topics: ["\u8ba4\u77e5"],
        languages: ["en"],
        source_ids: ["source-batch-fixture"],
      },
    },
    "batch-fixture-preferences",
  );
  const recommendation = new ReadingRecommendationService(work),
    scope = await recommendation.scope(owner);
  return { recommendation, scope };
}
export const recommendationFeed = (count = 30) =>
  "<rss><channel>" +
  Array.from(
    { length: count },
    (_, i) =>
      "<item><title>Thinking with evidence " +
      i +
      "</title><link>https://example.com/article-" +
      i +
      "</link><pubDate>2026-11-11</pubDate></item>",
  ).join("") +
  "</channel></rss>";
export const recommendationText =
  "Specific arguments and evidence explain how reasoning changes decisions, while limitations remain explicit. ".repeat(
    10,
  );
