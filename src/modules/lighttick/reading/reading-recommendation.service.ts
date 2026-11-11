import {readingSourceOptions} from "./reading-source-selection.ts";
import {READING_EXTRACTION_VERSION} from "./reading-recommendation-context.ts";
import { ReadingWorkService } from "./reading-work.service.ts";
import { defaultReadingPreferences } from "./reading-preferences.service.ts";
import {
  READING_CATALOG_REVISION,
} from "./reading-catalog.ts";
import { canonicalReadingURL } from "./reading-identity.ts";
import {
  readingShanghaiDate,
  READING_RANKING_VERSION,
} from "./reading-recommendation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import type {
  ReadingSelectedSource,
  ReadingRecommendationScope,
  ReadingRecommendationInput,
} from "./reading-recommendation.types.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import {
  digest,
  fail,
  object,
  keys,
} from "../learning/native-learning.validation.ts";
export class ReadingRecommendationService {
  constructor(readonly work: ReadingWorkService) {}
  async freeze(o: LightTickOwner): Promise<ReadingRecommendationInput> {
    const preferences =
        (await this.work.store.preferences.get(o)) ??
        defaultReadingPreferences(),
      all = await this.work.store.sources(o, "", 1001, true);
    if (all.length > 1000)
      fail(413, "Too many reading sources to freeze without pagination");
    const effective:ReadingSelectedSource[]=readingSourceOptions(all).filter(s=>s.available).map(({available,reason,...source})=>source);
    const ids = preferences.value.source_ids,
      selected =
        ids == null
          ? effective
          : ids.map((id) => {
              const source = effective.find((s) => s.id === id);
              if (!source)
                fail(409, "Selected reading source was removed or archived");
              return source;
            });
    if (selected.length > 20)
      fail(413, "Select at most20 reading sources before starting");
    const sources = selected.map(
      ({
        id,
        revision,
        title,
        url,
        format,
        language,
        topics,
        domains,
        catalog_id,
      }) => ({
        id,
        revision,
        title,
        url,
        format,
        ...(language !== undefined ? { language } : {}),
        ...(topics !== undefined ? { topics } : {}),
        ...(domains !== undefined ? { domains } : {}),
        ...(catalog_id !== undefined ? { catalog_id } : {}),
      }),
    );
    sources.sort((a, b) => a.id.localeCompare(b.id));
    const history = await this.work.repo.reading.recommendationHistory(o);
    if (history.length > 10000)
      fail(413, "Reading history exceeds frozen recommendation capacity");
    const seen = [
        ...new Set(
          history.flatMap((h) =>
            h.source_url ? [canonicalReadingURL(h.source_url)] : [],
          ),
        ),
      ].sort(),
      feedback = [...history]
        .sort((a, b) => (b.saved_at ?? "").localeCompare(a.saved_at ?? ""))
        .slice(0, 60)
        .map((h) => ({ ...h, source_url: null }));
    if (Buffer.byteLength(JSON.stringify({ seen, feedback })) > 1000000)
      fail(
        413,
        "Reading recommendation history exceeds1MB; nothing was truncated",
      );
    const base = {
      preferences,
      sources,
      catalog_revision: READING_CATALOG_REVISION,
      date: readingShanghaiDate(this.work.clock()),
      ranking_version: READING_RANKING_VERSION,
      extraction_version: READING_EXTRACTION_VERSION,
      seen_count: seen.length,
    };
    const scope: ReadingRecommendationScope = {
      ...base,
      digest: digest({ ...base, seen, feedback }),
    };
    return { scope, seen, feedback, automatic: false };
  }
  async scope(o: LightTickOwner) {
    return this.work.repo.transaction(o, async () => {
      await this.work.authorize();
      return (await this.freeze(o)).scope;
    });
  }
  async create(o: LightTickOwner, raw: unknown, key: string) {
    const b = structuredClone(object(raw));
    keys(b, ["scope_digest"]);
    if (
      typeof b.scope_digest !== "string" ||
      !/^[a-f0-9]{64}$/.test(b.scope_digest)
    )
      fail(422, "Review the frozen recommendation scope first");
    const id = "readwork-" + digest([o.appId, o.userId, key]).slice(0, 40);
    const result = await this.work.command(
      o,
      id,
      "work:recommend",
      b,
      key,
      async () => {
        const input = await this.freeze(o);
        if (input.scope.digest !== b.scope_digest)
          fail(
            409,
            "Preferences, source selection, date or reading history changed; review scope again",
          );
        const stamp=this.work.clock().toISOString(),usage=await this.work.store.usage(o,stamp.slice(0,10)+"T00:00:00.000Z",stamp);
        if(usage.daily>=20||usage.pending>=2)fail(429,"Finish or cancel pending reading work, or retry after today's quota resets");
        const now = this.work.clock().toISOString(),
          row: ReadingWork = {
            ...o,
            id,
            revision: 1,
            kind: "recommend",
            status: "queued",
            input: { recommendation: input },
            output: null,
            adopted: {},
            attempt: 0,
            fence: null,
            lease_until: null,
            error_code: null,
            created_at: now,
            updated_at: now,
          };
        await this.work.store.save(row, 0);
        return this.work.data(row);
      },
    );
    await this.work.dispatch(o, id);
    return result;
  }
}
