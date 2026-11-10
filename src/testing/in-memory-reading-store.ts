import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  ReadingRepository,
  ReadingArticle,
  ArticleQuery,
} from "../modules/lighttick/reading/reading.types.ts";
import { ApplicationError } from "../shared/errors.ts";
const key = (o: LightTickOwner, id: string) =>
  JSON.stringify([o.appId, o.userId, id]);
export class InMemoryReadingStore implements ReadingRepository {
  private rows = new Map<
    string,
    { owner: LightTickOwner; versions: ReadingArticle[] }
  >();
  async get(o: LightTickOwner, id: string) {
    return structuredClone(this.rows.get(key(o, id))?.versions.at(-1));
  }
  async list(o: LightTickOwner, q: ArticleQuery) {
    const rows = [...this.rows.values()]
      .filter((r) => r.owner.appId === o.appId && r.owner.userId === o.userId)
      .map((r) => r.versions.at(-1)!)
      .filter(
        (r) =>
          r.id > q.after &&
          r.archived === (q.filter === "archived") &&
          (r.content.title + "\n" + r.content.body)
            .toLowerCase()
            .includes(q.search.toLowerCase()) &&
          (!["bookmark", "later", "read", "feedback"].includes(q.filter) ||
            !!r.personal[
              q.filter as "bookmark" | "later" | "read" | "feedback"
            ]),
      );
    return structuredClone(
      rows.sort((a, b) => (a.id < b.id ? -1 : 1)).slice(0, q.limit),
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
    return structuredClone([...this.rows]);
  }
  restore(rows: ReturnType<InMemoryReadingStore["snapshot"]>) {
    this.rows = new Map(rows);
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, r] of this.rows)
      if (r.owner.appId === o.appId && r.owner.userId === o.userId)
        this.rows.delete(k);
  }
}
