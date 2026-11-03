import type {
  LightTickOperationRow,
  LightTickOwner,
} from "../../../modules/lighttick/lighttick.types.ts";
import type {
  LearningAuthority,
  LearningCollection,
  NativeLesson,
  LessonPublication,
  NativePrivateState,
  LearningHistoryEntry,
  NativeLearningRepository,
} from "../../../modules/lighttick/learning/native-learning.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { mapRow } from "./postgres-lighttick-row-mappers.ts";
type Query = (
  sql: string,
  values?: unknown[],
) => Promise<{
  rows: Record<string, unknown>[];
}>;
export class PostgresNativeLearningStore implements NativeLearningRepository {
  constructor(private readonly query: Query) {}
  private async one<T>(sql: string, args: unknown[]): Promise<T | undefined> {
    const r = await this.query(sql, args);
    return r.rows[0] ? mapRow<T>(r.rows[0]) : undefined;
  }
  private async put(sql: string, args: unknown[]) {
    const r = await this.query(sql + " RETURNING revision", args);
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Learning revision changed; preserve input.",
      );
  }
  async getNativeLearningCounts(o: LightTickOwner) {
    const result: Record<string, number> = {};
    for (const [name, table] of Object.entries({
      collections: "learning_collections",
      lessons: "native_lessons",
      publications: "lesson_publications",
      states: "native_learning_private",
      history: "native_learning_history",
    })) {
      const r = await this.query(
        "SELECT count(*)::int AS count FROM zook_lighttick_" +
          table +
          " WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      );
      result[name] = Number(r.rows[0].count);
    }
    return result;
  }
  async clearNativeLearningStaging(o: LightTickOwner) {
    for (const table of [
      "native_learning_history",
      "native_learning_private",
      "lesson_publications",
      "native_lessons",
      "learning_collections",
    ])
      await this.query(
        "DELETE FROM zook_lighttick_" +
          table +
          " WHERE app_id=$1 AND user_id=$2",
        [o.appId, o.userId],
      );
    await this.query(
      "DELETE FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND device_id='learning-migration'",
      [o.appId, o.userId],
    );
  }
  async listLearningReceipts(o: LightTickOwner, id: string) {
    const r = await this.query(
      "SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND entity_type='learning_private' AND entity_id=$3 AND operation_id LIKE 'learning-compat:%' ORDER BY created_at,operation_id LIMIT 1000",
      [o.appId, o.userId, id],
    );
    return r.rows.map((row) => mapRow<LightTickOperationRow>(row));
  }
  async getLearningAuthority(o: LightTickOwner) {
    return this.one<LearningAuthority>(
      "SELECT * FROM zook_lighttick_learning_authorities WHERE app_id=$1 AND user_id=$2 AND module='learning'",
      [o.appId, o.userId],
    );
  }
  async saveLearningAuthority(r: LearningAuthority, base: number) {
    await this.put(
      `INSERT INTO zook_lighttick_learning_authorities(app_id,user_id,module,phase,epoch,revision,manifest_hash,source_binding,updated_at,reading_enabled,private_enabled) SELECT $1,$2,'learning',$3,$4,$5,$6,$7,$8,$10,$11 WHERE $9=0 OR EXISTS(SELECT 1 FROM zook_lighttick_learning_authorities WHERE app_id=$1 AND user_id=$2 AND module='learning' AND revision=$9) ON CONFLICT(app_id,user_id,module) DO UPDATE SET phase=$3,epoch=$4,revision=$5,manifest_hash=$6,source_binding=$7,updated_at=$8,reading_enabled=$10,private_enabled=$11 WHERE zook_lighttick_learning_authorities.revision=$9`,
      [
        r.appId,
        r.userId,
        r.phase,
        r.epoch,
        r.revision,
        r.manifestHash,
        r.sourceBinding,
        r.updatedAt,
        base,
        r.readingEnabled,
        r.privateEnabled,
      ],
    );
  }
  async listLearningCollections(
    o: LightTickOwner,
    after: string,
    limit: number,
  ) {
    const r = await this.query(
      'SELECT * FROM zook_lighttick_learning_collections WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 ORDER BY id COLLATE "C" LIMIT $4',
      [o.appId, o.userId, after, limit],
    );
    return r.rows.map((row) => mapRow<LearningCollection>(row));
  }
  async getLearningCollection(o: LightTickOwner, id: string) {
    return this.one<LearningCollection>(
      "SELECT * FROM zook_lighttick_learning_collections WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
  }
  async saveLearningCollection(r: LearningCollection, base: number) {
    await this.put(
      `INSERT INTO zook_lighttick_learning_collections(app_id,user_id,id,title,revision,archived,updated_at) SELECT $1,$2,$3,$4,$5,$6,$7 WHERE $8=0 OR EXISTS(SELECT 1 FROM zook_lighttick_learning_collections WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$8) ON CONFLICT(app_id,user_id,id) DO UPDATE SET title=$4,revision=$5,archived=$6,updated_at=$7 WHERE zook_lighttick_learning_collections.revision=$8`,
      [
        r.appId,
        r.userId,
        r.id,
        r.title,
        r.revision,
        r.archived,
        r.updatedAt,
        base,
      ],
    );
  }
  async listNativeLessons(
    o: LightTickOwner,
    after: string,
    limit: number,
    collectionId?: string,
  ) {
    const r = await this.query(
      'SELECT * FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND ($5::text IS NULL OR collection_id=$5) ORDER BY id COLLATE "C" LIMIT $4',
      [o.appId, o.userId, after, limit, collectionId ?? null],
    );
    return r.rows.map((row) => mapRow<NativeLesson>(row));
  }
  async getNativeLesson(o: LightTickOwner, id: string) {
    return this.one<NativeLesson>(
      "SELECT * FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
  }
  async saveNativeLesson(r: NativeLesson, base: number) {
    try {
      await this.put(
        `INSERT INTO zook_lighttick_native_lessons(app_id,user_id,id,collection_id,number,title,revision,published_version,archived,updated_at,source_completed) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$12 WHERE $11=0 OR EXISTS(SELECT 1 FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$11) ON CONFLICT(app_id,user_id,id) DO UPDATE SET title=$6,revision=$7,published_version=$8,archived=$9,updated_at=$10,source_completed=$12 WHERE zook_lighttick_native_lessons.revision=$11`,
        [
          r.appId,
          r.userId,
          r.id,
          r.collectionId,
          r.number,
          r.title,
          r.revision,
          r.publishedVersion,
          r.archived,
          r.updatedAt,
          base,
          r.sourceCompleted ?? false,
        ],
      );
    } catch (error) {
      if (
        (
          error as {
            code?: string;
          }
        ).code === "23505"
      )
        throw new ApplicationError(
          409,
          "LIGHTTICK_VERSION_CONFLICT",
          "Lesson ordinal belongs to another identity.",
        );
      throw error;
    }
  }
  async getLessonPublication(o: LightTickOwner, id: string, v: string) {
    return this.one<LessonPublication>(
      "SELECT * FROM zook_lighttick_lesson_publications WHERE app_id=$1 AND user_id=$2 AND lesson_id=$3 AND content_version=$4",
      [o.appId, o.userId, id, v],
    );
  }
  async insertLessonPublication(r: LessonPublication) {
    await this.query(
      "INSERT INTO zook_lighttick_lesson_publications VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING",
      [
        r.appId,
        r.userId,
        r.lessonId,
        r.contentVersion,
        r.content,
        r.references,
        r.sourceUrl,
        r.createdAt,
      ],
    );
    const old = await this.getLessonPublication(
      r,
      r.lessonId,
      r.contentVersion,
    );
    if (
      !old ||
      old.content !== r.content ||
      old.references !== r.references ||
      old.sourceUrl !== r.sourceUrl
    )
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "Published content is immutable.",
      );
  }
  async getNativePrivateState(o: LightTickOwner, id: string, v: string) {
    return this.one<NativePrivateState>(
      "SELECT * FROM zook_lighttick_native_learning_private WHERE app_id=$1 AND user_id=$2 AND lesson_id=$3 AND content_version=$4",
      [o.appId, o.userId, id, v],
    );
  }
  async saveNativePrivateState(r: NativePrivateState, base: number) {
    await this.put(
      `INSERT INTO zook_lighttick_native_learning_private SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15 WHERE $16=0 OR EXISTS(SELECT 1 FROM zook_lighttick_native_learning_private WHERE app_id=$1 AND user_id=$2 AND lesson_id=$3 AND content_version=$4 AND revision=$16) ON CONFLICT(app_id,user_id,lesson_id,content_version) DO UPDATE SET revision=$5,notes_revision=$6,position_revision=$7,completion_revision=$8,notes=$9,answers=$10::jsonb,position=$11,completed=$12,completed_at=$13,updated_at=$14,draft_version=$15 WHERE zook_lighttick_native_learning_private.revision=$16`,
      [
        r.appId,
        r.userId,
        r.lessonId,
        r.contentVersion,
        r.revision,
        r.notesRevision,
        r.positionRevision,
        r.completionRevision,
        r.notes,
        JSON.stringify(r.answers),
        r.position,
        r.completed,
        r.completedAt,
        r.updatedAt,
        r.draftVersion ?? r.contentVersion,
        base,
      ],
    );
  }
  async appendLearningHistory(r: LearningHistoryEntry) {
    await this.query(
      "INSERT INTO zook_lighttick_native_learning_history VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)",
      [
        r.appId,
        r.userId,
        r.id,
        r.lessonId,
        r.contentVersion,
        r.component,
        r.revision,
        JSON.stringify(r.state),
        r.createdAt,
      ],
    );
  }
  async listLearningHistory(
    o: LightTickOwner,
    id: string,
    v: string,
    before: string,
    limit: number,
  ) {
    const r = await this.query(
      "SELECT * FROM zook_lighttick_native_learning_history WHERE app_id=$1 AND user_id=$2 AND lesson_id=$3 AND content_version=$4 AND ($5='' OR revision<NULLIF($5,'')::int) ORDER BY revision DESC LIMIT $6",
      [o.appId, o.userId, id, v, before, limit],
    );
    return r.rows.map((row) => mapRow<LearningHistoryEntry>(row));
  }
}
