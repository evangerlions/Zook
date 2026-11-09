import { sourceKey } from "../../../modules/lighttick/knowledge/knowledge.types.ts";
import type {
  KnowledgeEntry,
  KnowledgeRepository,
  LearningFact,
} from "../../../modules/lighttick/knowledge/knowledge.types.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
type Query = (
  sql: string,
  args?: unknown[],
) => Promise<{ rows: Record<string, any>[] }>;
export class PostgresKnowledgeStore implements KnowledgeRepository {
  constructor(private readonly query: Query) {}
  async learningExport(o: LightTickOwner, includePrivate: boolean) {
    const read = async (table: string) => {
      const r = await this.query(
        `SELECT t.* FROM zook_lighttick_${table} t JOIN zook_lighttick_native_lessons l ON (l.app_id,l.user_id,l.id)=(t.app_id,t.user_id,t.lesson_id) JOIN zook_lighttick_learning_collections c ON (c.app_id,c.user_id,c.id)=(l.app_id,l.user_id,l.collection_id) WHERE t.app_id=$1 AND t.user_id=$2 AND NOT l.archived AND NOT c.archived ORDER BY t.lesson_id LIMIT 5001`,
        [o.appId, o.userId],
      );
      if (r.rows.length > 5000)
        throw new ApplicationError(
          413,
          "VALIDATION_ERROR",
          "Learning export exceeds 5000 rows; chunking is required.",
        );
      return r.rows.map((row) => mapRow<any>(row));
    };
    return {
      publications: await read("lesson_publications"),
      states: includePrivate ? await read("native_learning_private") : [],
      history: includePrivate ? await read("native_learning_history") : [],
    };
  }
  async availableSources(
    o: LightTickOwner,
    sources: import("../../../modules/lighttick/knowledge/knowledge.types.ts").KnowledgeSource[],
  ) {
    const rows = await this.query(
      `SELECT s.* FROM jsonb_to_recordset($3::jsonb) AS s(kind text,id text,version text) WHERE
   (s.kind='record' AND EXISTS(SELECT 1 FROM zook_lighttick_records r JOIN zook_lighttick_record_versions v ON (r.app_id,r.user_id,r.id)=(v.app_id,v.user_id,v.record_id) WHERE r.app_id=$1 AND r.user_id=$2 AND r.id=s.id AND v.version::text=s.version AND r.payload->>'archived_at' IS NULL)) OR
   (s.kind='lesson' AND EXISTS(SELECT 1 FROM zook_lighttick_learning_authorities a JOIN zook_lighttick_native_lessons l ON (l.app_id,l.user_id)=(a.app_id,a.user_id) JOIN zook_lighttick_learning_collections c ON (c.app_id,c.user_id,c.id)=(l.app_id,l.user_id,l.collection_id) JOIN zook_lighttick_lesson_publications p ON (p.app_id,p.user_id,p.lesson_id)=(l.app_id,l.user_id,l.id) WHERE a.app_id=$1 AND a.user_id=$2 AND a.phase='zook' AND a.reading_enabled AND NOT l.archived AND NOT c.archived AND l.id=s.id AND p.content_version=s.version))`,
      [o.appId, o.userId, JSON.stringify(sources)],
    );
    return rows.rows.map((r) => sourceKey(r as any));
  }
  async get(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_knowledge WHERE app_id=$1 AND user_id=$2 AND id=$3",
        [o.appId, o.userId, id],
      )
    ).rows[0]?.payload as KnowledgeEntry | undefined;
  }
  async list(o: LightTickOwner) {
    return (
      await this.query(
        'SELECT payload FROM zook_lighttick_knowledge WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE "C" LIMIT 5001',
        [o.appId, o.userId],
      )
    ).rows.map((r) => r.payload as KnowledgeEntry);
  }
  async history(o: LightTickOwner, id: string, before: number, limit: number) {
    return (
      await this.query(
        "SELECT payload FROM zook_lighttick_knowledge_versions WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision<$4 ORDER BY revision DESC LIMIT $5",
        [o.appId, o.userId, id, before, limit],
      )
    ).rows.map((r) => r.payload as KnowledgeEntry);
  }
  async save(o: LightTickOwner, e: KnowledgeEntry, base: number) {
    const args = [o.appId, o.userId, e.id, e.revision, JSON.stringify(e)];
    const row =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_knowledge VALUES($1,$2,$3,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING id",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_knowledge SET revision=$4,payload=$5::jsonb WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$6 RETURNING id",
            [...args, base],
          );
    if (!row.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Knowledge changed; retain the local draft.",
      );
    await this.query(
      "INSERT INTO zook_lighttick_knowledge_versions VALUES($1,$2,$3,$4,$5::jsonb)",
      args,
    );
  }
  async learningFacts(o: LightTickOwner): Promise<LearningFact[]> {
    const rows = await this.query(
      `SELECT row_to_json(l) AS lesson,row_to_json(p) AS publication,row_to_json(s) AS state,(SELECT max(h.created_at) FROM zook_lighttick_native_learning_history h WHERE (h.app_id,h.user_id,h.lesson_id,h.content_version)=(s.app_id,s.user_id,s.lesson_id,s.content_version) AND h.component IN ('initial','notes','import') AND (h.state->>'notesRevision')::int=s.notes_revision) AS notes_updated_at FROM zook_lighttick_native_lessons l
  JOIN zook_lighttick_learning_collections c ON (c.app_id,c.user_id,c.id)=(l.app_id,l.user_id,l.collection_id)
  JOIN zook_lighttick_lesson_publications p ON (p.app_id,p.user_id,p.lesson_id,p.content_version)=(l.app_id,l.user_id,l.id,l.published_version)
  LEFT JOIN zook_lighttick_native_learning_private s ON (s.app_id,s.user_id,s.lesson_id,s.content_version)=(l.app_id,l.user_id,l.id,l.published_version)
  WHERE l.app_id=$1 AND l.user_id=$2 AND NOT l.archived AND NOT c.archived ORDER BY l.id COLLATE "C" LIMIT 5001`,
      [o.appId, o.userId],
    );
    return rows.rows.map((r) => ({
      notesUpdatedAt:r.notes_updated_at instanceof Date?r.notes_updated_at.toISOString():r.notes_updated_at??null,
      lesson: mapRow(r.lesson),
      publication: mapRow(r.publication),
      state: r.state ? mapRow(r.state) : null,
    }));
  }
}
