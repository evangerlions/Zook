import { createHash } from "node:crypto";
import { READING_TOPICS } from "./reading-catalog.ts";
import { canonicalReadingURL } from "./reading-identity.ts";
import type { ReadingCandidate } from "./reading-candidate.types.ts";
import type { ReadingPreferencesValue } from "./reading-preferences.types.ts";
export const READING_RANKING_VERSION = "grow-reading-rank-v2";
export interface ReadingRecommendationHistory {
  source_url: string | null;
  topics: string[];
  feedback_value: string | null;
  saved_at: string | null;
}
const sha = (v: string) => createHash("sha256").update(v).digest("hex");
export function readingShanghaiDate(now: Date): string {
  return new Date(now.getTime() + 8 * 3600000).toISOString().slice(0, 10);
}
function publishedDate(c: ReadingCandidate) {
  if (c.content.published_date) return c.content.published_date;
  if (!c.content.published_at) return null;
  const stamp = Date.parse(c.content.published_at);
  return Number.isFinite(stamp) ? readingShanghaiDate(new Date(stamp)) : null;
}
export function readingCandidateMatches(
  c: ReadingCandidate,
  prefs: ReadingPreferencesValue,
): boolean {
  if (
    !prefs.languages.includes(c.content.language.split("-")[0] as "zh" | "en")
  )
    return false;
  const hay = [c.content.title, c.content.description, c.excerpt]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    keywords = READING_TOPICS as Record<string, readonly string[]>;
  const matched = prefs.topics.some((topic) =>
    keywords[topic]?.some((word) => hay.includes(word)),
  );
  if (
    !matched &&
    !(
      c.content.category === "classic" &&
      prefs.topics.some((t) => c.content.topics?.includes(t))
    )
  )
    return false;
  const query = prefs.query.trim().toLowerCase();
  if (!query) return true;
  const groups = (query.match(/[a-z0-9]+|[\u4e00-\u9fff]+/g) ?? []).map(
    (word) => keywords[word] ?? [word],
  );
  return groups.some((group) => group.some((word) => hay.includes(word)));
}
/** Deterministic legacy ranking with explicit date precision and stable topic iteration. Never infers completion or duration. */
export function chooseReadingCandidates(
  candidates: ReadingCandidate[],
  prefs: ReadingPreferencesValue,
  seen: ReadonlySet<string>,
  today: string,
  seed: string,
  history: ReadingRecommendationHistory[] = [],
  selected: ReadingCandidate[] = [],
): ReadingCandidate[] {
  if (selected.length > prefs.count) throw Error("READING_SELECTED_COUNT_EXCEEDS_REQUEST");
  const cutoff = new Date(today + "T00:00:00Z");
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const earliest = cutoff.toISOString().slice(0, 10),
    eligible = new Map<string, ReadingCandidate>();
  for (const c of candidates) {
    if (!c.content.source_url || !readingCandidateMatches(c, prefs)) continue;
    const id = canonicalReadingURL(c.content.source_url),
      date = publishedDate(c);
    if (seen.has(id) || seen.has(c.id)) continue;
    if (
      c.content.category === "recent" &&
      (!date || date < earliest || date > today)
    )
      continue;
    if (prefs.mode !== "mixed" && c.content.category !== prefs.mode) continue;
    if (!["recent", "classic"].includes(c.content.category ?? "")) continue;
    if (!eligible.has(id)) eligible.set(id, c);
  }
  const signals = new Map(prefs.topics.map((t) => [t, [] as number[]]));
  for (const h of [...history]
    .sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))
    .slice(0, 60)) {
    const signal = (
      { insightful: 1, neutral: 0, not_for_me: -1 } as Record<string, number>
    )[h.feedback_value ?? ""];
    if (signal === undefined) continue;
    for (const topic of new Set(h.topics)) {
      const list = signals.get(topic);
      if (list) list.push(signal);
    }
  }
  const weights = new Map(
    [...signals].map(([topic, values]) => [
      topic,
      values.reduce((a, b) => a + b, 0) / (values.length + 3),
    ]),
  );
  const result = [...selected],
    used = new Set(result.map((c) => c.content.publisher ?? "")),
    covered = new Set(result.flatMap((c) => c.content.topics ?? [])),
    categories =
      prefs.mode === "mixed"
        ? [...Array(Math.max(0, prefs.count - 1)).fill("recent"), "classic"]
        : Array(prefs.count).fill(prefs.mode);
  for (const c of result) {
    const index = categories.indexOf(c.content.category);
    if (index >= 0) categories.splice(index, 1);
    else categories.shift();
  }
  for (const category of categories) {
    const chosen = new Set(
      result.map((c) =>
        c.content.source_url ? canonicalReadingURL(c.content.source_url) : c.id,
      ),
    );
    let options = [...eligible.entries()].filter(
      ([id, c]) => c.content.category === category && !chosen.has(id),
    );
    if (!options.length && prefs.mode === "mixed")
      options = [...eligible.entries()].filter(([id]) => !chosen.has(id));
    const uncovered = (c: ReadingCandidate) =>
      new Set(
        (c.content.topics ?? []).filter(
          (t) => prefs.topics.includes(t) && !covered.has(t),
        ),
      ).size;
    const interest = (c: ReadingCandidate) =>
      [...new Set(c.content.topics ?? [])]
        .sort()
        .reduce((sum, t) => sum + (weights.get(t) ?? 0), 0) /
      Math.max(1, c.content.topics?.length ?? 0);
    const languages = new Set(result.map((c) => c.content.language));
    options.sort(
      ([aId, a], [bId, b]) =>
        uncovered(b) - uncovered(a) ||
        (result.length % 3 === 2 ? 0 : interest(b) - interest(a)) ||
        Number(used.has(a.content.publisher ?? "")) -
          Number(used.has(b.content.publisher ?? "")) ||
        Number(languages.has(a.content.language)) -
          Number(languages.has(b.content.language)) ||
        sha(seed + ":" + aId).localeCompare(sha(seed + ":" + bId)),
    );
    if (options.length) {
      const c = options[0][1];
      result.push(c);
      used.add(c.content.publisher ?? "");
      for (const topic of c.content.topics ?? []) covered.add(topic);
    }
  }
  return result;
}
