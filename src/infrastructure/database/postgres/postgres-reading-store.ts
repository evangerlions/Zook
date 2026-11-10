import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  ReadingRepository,
  ReadingArticle,
  ArticleQuery,
} from "../../../modules/lighttick/reading/reading.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresReadingStore implements ReadingRepository {
  constructor(readonly query: Query) {}
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as ReadingArticle | undefined;
  }
  async list(o: LightTickOwner, q: ArticleQuery) {
    const search = q.search.replace(/[\\%_]/g, "\\$&");
    return (
      await this.query(
        `SELECT payload FROM zook_lighttick_reading_articles WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND (payload->>'archived')::boolean=$4 AND
      ((payload->'content'->>'title')||E'\\n'||(payload->'content'->>'body')) ILIKE $5 AND
      ($6 NOT IN ('bookmark','later','read','feedback') OR CASE WHEN $6='feedback' THEN length(payload->'personal'->>'feedback')>0 ELSE (payload->'personal'->>$6)::boolean END)
      ORDER BY id COLLATE "C" LIMIT $7`,
        [
          o.appId,
          o.userId,
          q.after,
          q.filter === "archived",
          "%" + search + "%",
          q.filter,
          q.limit,
        ],
      )
    ).rows.map((r) => r.payload as ReadingArticle);
  }
  async history(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_reading_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision::bigint<$4::bigint ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as ReadingArticle);
  }
  async save(o: LightTickOwner, row: ReadingArticle, base: number) {
    const args = [o.appId, o.userId, row.id, row.revision, JSON.stringify(row)];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_reading_articles(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_reading_articles SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",
            [...args, base],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Article changed; retain the input.",
      );
    await this.query(
      "INSERT INTO zook_lighttick_reading_versions(app_id,user_id,id,revision,payload) VALUES($1,$2,$3,$4,$5::jsonb)",
      args,
    );
  }
}
