import test from "node:test";
import assert from "node:assert/strict";
import {
  chooseReadingCandidates,
  readingCandidateMatches,
  readingShanghaiDate,
  READING_RANKING_VERSION,
} from "../../src/modules/lighttick/reading/reading-recommendation.ts";
import {
  readingCandidateId,
  canonicalReadingURL,
} from "../../src/modules/lighttick/reading/reading-identity.ts";
import { defaultReadingPreferences } from "../../src/modules/lighttick/reading/reading-preferences.service.ts";
import type { ReadingCandidate } from "../../src/modules/lighttick/reading/reading-candidate.types.ts";
const candidate = (
  id: string,
  changes: Partial<ReadingCandidate["content"]> = {},
): ReadingCandidate => ({
  id: readingCandidateId("https://example.com/" + id),
  source_id: null,
  source_revision: null,
  excerpt: "Thinking with evidence improves decisions.",
  content: {
    title: "Thinking and learning with evidence " + id,
    source_url: "https://example.com/" + id,
    language: "en",
    published_at: null,
    published_date: "2026-11-10",
    category: "recent",
    publisher: id,
    topics: ["认知"],
    ...changes,
  },
});
test("recent recommendations exclude unknown/future/stale dates and canonical seen URLs while retaining date-only precision", () => {
  const prefs = {
      ...defaultReadingPreferences().value,
      mode: "recent" as const,
      count: 8,
      topics: ["认知"],
    },
    good = candidate("good"),
    rows = [
      good,
      candidate("unknown", { published_date: null }),
      candidate("future", { published_date: "2026-11-13" }),
      candidate("old", { published_date: "2026-10-12" }),
      candidate("boundary", { published_date: "2026-10-13" }),
      candidate("timestamp", {
        published_date: null,
        published_at: "2026-11-11T16:30:00Z",
      }),
    ];
  assert.equal(
    readingShanghaiDate(new Date("2026-11-11T16:30:00Z")),
    "2026-11-12",
  );
  const chosen = chooseReadingCandidates(
    rows,
    prefs,
    new Set([canonicalReadingURL("http://example.com/good?utm_source=seen")]),
    "2026-11-12",
    "fixed",
  );
  assert.deepEqual(
    chosen.map((c) => c.content.title).sort(),
    [rows[4], rows[5]].map((c) => c.content.title).sort(),
  );
  assert.equal(good.content.published_at, null);
  assert.equal(good.content.published_date, "2026-11-10");
});
test("topic and literal bilingual query groups, classics and mixed source/language coverage retain legacy selection semantics", () => {
  const prefs = {
      ...defaultReadingPreferences().value,
      count: 3,
      topics: ["认知", "成长"],
    },
    cognitive = candidate("cognition", { publisher: "same", topics: ["认知"] }),
    growth = candidate("growth", {
      title: "Career work and habits",
      language: "zh",
      publisher: "different",
      topics: ["成长"],
    }),
    classic = candidate("classic", {
      title: "Old canonical essay",
      category: "classic",
      published_date: null,
      topics: ["成长"],
    });
  assert.ok(readingCandidateMatches(cognitive, { ...prefs, query: "认知" }));
  assert.equal(
    readingCandidateMatches(cognitive, { ...prefs, query: "unmatchedword" }),
    false,
  );
  assert.equal(
    readingCandidateMatches(cognitive, { ...prefs, query: "!!!" }),
    false,
  );
  assert.ok(
    readingCandidateMatches(cognitive, {
      ...prefs,
      query: "unmatchedword evidence",
    }),
  );
  const chosen = chooseReadingCandidates(
    [cognitive, growth, classic],
    prefs,
    new Set(),
    "2026-11-12",
    "fixed",
  );
  assert.equal(chosen.length, 3);
  assert.equal(
    chosen.filter((c) => c.content.category === "classic").length,
    1,
  );
  assert.equal(new Set(chosen.map((c) => c.content.publisher)).size, 3);
  assert.equal(new Set(chosen.map((c) => c.content.language)).size, 2);
  assert.equal(
    chooseReadingCandidates(
      [classic],
      { ...prefs, mode: "classic" },
      new Set(),
      "2026-11-12",
      "fixed",
    ).length,
    1,
  );
});
test("selection is stable per frozen seed, deduplicates canonical links, preserves prior full-text successes and uses bounded explicit feedback", () => {
  const prefs = {
      ...defaultReadingPreferences().value,
      count: 8,
      mode: "recent" as const,
      topics: ["认知", "成长"],
    },
    rows = Array.from({ length: 12 }, (_, i) =>
      candidate("entry-" + i, { topics: i % 2 ? ["成长"] : ["认知"] }),
    );
  const first = chooseReadingCandidates(
    rows,
    prefs,
    new Set(),
    "2026-11-12",
    "fixed",
  );
  assert.equal(first.length, 8);
  assert.deepEqual(
    chooseReadingCandidates(
      [...rows].reverse(),
      prefs,
      new Set(),
      "2026-11-12",
      "fixed",
    ).map((c) => c.id),
    first.map((c) => c.id),
  );
  const resumed = chooseReadingCandidates(
    rows,
    prefs,
    new Set(first.slice(1).map((c) => c.id)),
    "2026-11-12",
    "fixed",
    [],
    first.slice(0, 1),
  );
  assert.equal(resumed[0].id, first[0].id);
  assert.equal(resumed.length, 5);
  const positive = Array.from({ length: 60 }, () => ({
      source_url: null,
      topics: ["成长"],
      feedback_value: "insightful",
      saved_at: "2026-11-11T00:00:00Z",
    })),
    weighted = chooseReadingCandidates(
      rows,
      { ...prefs, count: 1 },
      new Set(),
      "2026-11-12",
      "fixed",
      positive,
    );
  assert.deepEqual(weighted[0].content.topics, ["成长"]);
  assert.equal(READING_RANKING_VERSION, "grow-reading-rank-v2");
  const duplicate = {
    ...rows[0],
    id: "candidate-" + "f".repeat(40),
    content: {
      ...rows[0].content,
      source_url: rows[0].content.source_url + "?utm_source=duplicate",
    },
  };
  assert.equal(
    chooseReadingCandidates(
      [rows[0], duplicate],
      prefs,
      new Set(),
      "2026-11-12",
      "fixed",
    ).length,
    1,
  );
});

test("resuming never silently drops already verified full-text selections", () => {
  const prefs = {...defaultReadingPreferences().value, count:1};
  assert.throws(() => chooseReadingCandidates([], prefs, new Set(), "2026-11-12", "fixed", [], [candidate("one"), candidate("two")]), /READING_SELECTED_COUNT_EXCEEDS_REQUEST/);
});
