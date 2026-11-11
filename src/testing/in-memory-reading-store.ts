import { readingReviewProjection } from "../modules/lighttick/reading/reading-review-projection.ts";
import { readingCatalogEntry } from "../modules/lighttick/reading/reading-article-projection.ts";
import {
  hasReadingFeedback,
  readingSearchText,
} from "../modules/lighttick/reading/reading-feedback.ts";
import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingRepository,
  ReadingArticle,
  ArticleQuery,
} from "../modules/lighttick/reading/reading.types.ts";
import type {
  VocabularyEntry,
  VocabularyReview,
  VocabularyQuery,
} from "../modules/lighttick/reading/vocabulary.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryReadingStore implements ReadingRepository {
  private vocabulary = new Map<
    string,
    {
      owner: LightTickOwner;
      entry: VocabularyEntry | null;
      reviews: VocabularyReview[];
      reviewRevisions: number[];
    }
  >();
  async getVocabulary(o: LightTickOwner, id: string) {
    return structuredClone(this.vocabulary.get(key(o, id))?.entry ?? undefined);
  }
  async duplicateVocabulary(
    o: LightTickOwner,
    article: string,
    normalized: string,
  ) {
    return (await this.listVocabulary(o)).some(
      (r) => r.article_id === article && r.normalized === normalized,
    );
  }
  async vocabularyPage(o: LightTickOwner, q: VocabularyQuery) {
    const rows = (await this.listVocabulary(o)).filter(
      (r) => !q.article_id || r.article_id === q.article_id,
    );
    const active = (r: VocabularyEntry) => !r.paused && !r.archived,
      due = (r: VocabularyEntry) => active(r) && r.next_review <= q.today;
    const stats = {
      total: rows.length,
      active: rows.filter(active).length,
      paused: rows.filter((r) => r.paused).length,
      archived: rows.filter((r) => r.archived).length,
      due: rows.filter(due).length,
    };
    const items = rows
      .filter((r) =>
        q.filter === "due"
          ? due(r)
          : q.filter === "paused"
            ? r.paused && !r.archived
            : q.filter === "archived"
              ? r.archived
              : q.filter === "all" || !r.archived,
      )
      .filter((r) =>
        q.filter === "due"
          ? r.next_review > q.after_date ||
            (r.next_review === q.after_date && r.id > q.after_id)
          : r.id > q.after_id,
      );
    items.sort((a, b) =>
      q.filter === "due" && a.next_review !== b.next_review
        ? a.next_review < b.next_review
          ? -1
          : 1
        : a.id < b.id
          ? -1
          : 1,
    );
    return { items: items.slice(0, q.limit), stats };
  }
  async vocabularyIdUsed(o: LightTickOwner, id: string) {
    return this.vocabulary.has(key(o, id));
  }
  async listVocabulary(o: LightTickOwner) {
    return structuredClone(
      [...this.vocabulary.values()]
        .filter(
          (r) =>
            r.owner.appId === o.appId && r.owner.userId === o.userId && r.entry,
        )
        .map((r) => r.entry!),
    );
  }
  async listVocabularyReviews(o: LightTickOwner, id: string) {
    return structuredClone(this.vocabulary.get(key(o, id))?.reviews ?? []);
  }
  async saveVocabulary(
    o: LightTickOwner,
    entry: VocabularyEntry,
    review?: VocabularyReview,
  ) {
    const previous = this.vocabulary.get(key(o, entry.id));
    this.vocabulary.set(key(o, entry.id), {
      owner: { ...o },
      entry: structuredClone(entry),
      reviewRevisions: [
        ...(previous?.reviewRevisions ?? []),
        ...(review ? [entry.revision] : []),
      ],
      reviews: [
        ...(previous?.reviews ?? []),
        ...(review ? [structuredClone(review)] : []),
      ],
    });
  }
  async deleteVocabulary(o: LightTickOwner, id: string) {
    this.vocabulary.set(key(o, id), {
      owner: { ...o },
      entry: null,
      reviews: [],
      reviewRevisions: [],
    });
  }
  private rows = new Map<
    string,
    { owner: LightTickOwner; versions: ReadingArticle[] }
  >();
  async recommendationHistory(o: LightTickOwner) {
    return structuredClone(
      [...this.rows.values()]
        .filter((r) => r.owner.appId === o.appId && r.owner.userId === o.userId)
        .map((r) => r.versions.at(-1)!)
        .map((r) => ({
          source_url: r.content.source_url,
          topics: r.content.topics ?? [],
          feedback_value: r.personal.structured_feedback?.value ?? null,
          saved_at: r.created_at,
        })),
    );
  }
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id))?.versions.at(-1));
  }
  async reviewProjection(o: LightTickOwner, query: string, limit: number) {
    return [...this.rows.values()]
      .filter((r) => r.owner.appId === o.appId && r.owner.userId === o.userId)
      .map((r) => r.versions.at(-1)!)
      .filter(
        (r) =>
          !query ||
          readingSearchText(r).toLowerCase().includes(query.toLowerCase()),
      )
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .slice(0, limit)
      .map((r) => readingReviewProjection(r, query));
  }
  private matching(o: LightTickOwner, q: ArticleQuery) {
    const rows = [...this.rows.values()]
      .filter((r) => r.owner.appId === o.appId && r.owner.userId === o.userId)
      .map((r) => r.versions.at(-1)!)
      .filter(
        (r) =>
          r.id > q.after &&
          r.archived === (q.filter === "archived") &&
          readingSearchText(r).toLowerCase().includes(q.search.toLowerCase()) &&
          (q.filter === "feedback"
            ? hasReadingFeedback(r)
            : !["bookmark", "later", "read"].includes(q.filter) ||
              !!r.personal[q.filter as "bookmark" | "later" | "read"]),
      );
    return rows.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, q.limit);
  }
  async list(o: LightTickOwner, q: ArticleQuery) {
    return structuredClone(this.matching(o, q));
  }
  async catalog(o: LightTickOwner, q: ArticleQuery) {
    return this.matching(o, q).map(readingCatalogEntry);
  }
  async editions(
    o: LightTickOwner,
    rootId: string,
    after: string,
    limit: number,
  ) {
    return structuredClone(
      [...this.rows.values()]
        .filter((r) => r.owner.appId === o.appId && r.owner.userId === o.userId)
        .map((r) => r.versions.at(-1)!)
        .filter(
          (r) =>
            r.id > after &&
            (r.id === rootId || r.provenance?.root_article_id === rootId),
        )
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .slice(0, limit),
    );
  }
  async history(o: LightTickOwner, id: string, before: number, limit: number) {
    return structuredClone(
      (this.rows.get(key(o, id))?.versions ?? [])
        .filter((r) => r.revision < before)
        .reverse()
        .slice(0, limit),
    );
  }
  async save(o: LightTickOwner, row: ReadingArticle, base: number) {
    const previous = this.rows.get(key(o, row.id));
    if ((previous?.versions.at(-1)?.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Article changed.",
      );
    this.rows.set(key(o, row.id), {
      owner: { ...o },
      versions: [...(previous?.versions ?? []), structuredClone(row)],
    });
  }
  snapshot() {
    return structuredClone({
      articles: [...this.rows],
      vocabulary: [...this.vocabulary],
    });
  }
  restore(rows: ReturnType<InMemoryReadingStore["snapshot"]>) {
    this.rows = new Map(rows.articles);
    this.vocabulary = new Map(rows.vocabulary);
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, r] of this.vocabulary)
      if (r.owner.appId === o.appId && r.owner.userId === o.userId)
        this.vocabulary.delete(k);
    for (const [k, r] of this.rows)
      if (r.owner.appId === o.appId && r.owner.userId === o.userId)
        this.rows.delete(k);
  }
}
