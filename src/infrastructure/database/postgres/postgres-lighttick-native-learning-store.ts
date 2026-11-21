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
  LearningModule,
  LearningModuleTemplate,
  UserSubscription,
  StorageUsage,
  StorageConfig,
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
    moduleId?: string,
  ) {
    const r = await this.query(
      'SELECT * FROM zook_lighttick_learning_collections WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND ($5::text IS NULL OR module_id=$5) ORDER BY id COLLATE "C" LIMIT $4',
      [o.appId, o.userId, after, limit, moduleId ?? null],
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
      `INSERT INTO zook_lighttick_learning_collections(app_id,user_id,id,module_id,title,description,revision,archived,updated_at) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9 WHERE $10=0 OR EXISTS(SELECT 1 FROM zook_lighttick_learning_collections WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$10) ON CONFLICT(app_id,user_id,id) DO UPDATE SET module_id=$4,title=$5,description=$6,revision=$7,archived=$8,updated_at=$9 WHERE zook_lighttick_learning_collections.revision=$10`,
      [
        r.appId,
        r.userId,
        r.id,
        r.moduleId,
        r.title,
        r.description,
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
    moduleId?: string,
  ) {
    const r = await this.query(
      'SELECT * FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2 AND id COLLATE "C">$3 AND ($5::text IS NULL OR collection_id=$5) AND ($6::text IS NULL OR module_id=$6) ORDER BY id COLLATE "C" LIMIT $4',
      [o.appId, o.userId, after, limit, collectionId ?? null, moduleId ?? null],
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
        `INSERT INTO zook_lighttick_native_lessons(app_id,user_id,id,collection_id,module_id,number,title,revision,published_version,archived,updated_at,source_completed,source_completed_version) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$13,$14 WHERE $12=0 OR EXISTS(SELECT 1 FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$12) ON CONFLICT(app_id,user_id,id) DO UPDATE SET collection_id=$4,module_id=$5,number=$6,title=$7,revision=$8,published_version=$9,archived=$10,updated_at=$11,source_completed=$13,source_completed_version=$14 WHERE zook_lighttick_native_lessons.revision=$12`,
        [
          r.appId,
          r.userId,
          r.id,
          r.collectionId,
          r.moduleId,
          r.number,
          r.title,
          r.revision,
          r.publishedVersion,
          r.archived,
          r.updatedAt,
          base,
          r.sourceCompleted ?? false,
          r.sourceCompletedVersion??(r.sourceCompleted?r.publishedVersion:null),
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
  async listLearningModules(o: LightTickOwner) {
    const r = await this.query(
      "SELECT * FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 ORDER BY id COLLATE \"C\"",
      [o.appId, o.userId],
    );
    return r.rows.map((row) => mapRow<LearningModule>(row));
  }
  async getLearningModule(o: LightTickOwner, id: string) {
    return this.one<LearningModule>(
      "SELECT * FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 AND id=$3",
      [o.appId, o.userId, id],
    );
  }
  async saveLearningModule(r: LearningModule, base: number) {
    await this.put(
      `INSERT INTO zook_lighttick_learning_modules(
        app_id,user_id,id,title,description,enabled,source_type,source_url,source_path,
        owner_id,is_public,subscriber_count,last_synced_at,sync_status,storage_used,source_config,storage_config,
        revision,created_at,updated_at
      ) SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
      WHERE $21=0 OR EXISTS(
        SELECT 1 FROM zook_lighttick_learning_modules
        WHERE app_id=$1 AND user_id=$2 AND id=$3 AND revision=$21
      )
      ON CONFLICT(app_id,user_id,id) DO UPDATE SET
        title=$4,description=$5,enabled=$6,source_type=$7,source_url=$8,source_path=$9,
        owner_id=$10,is_public=$11,subscriber_count=$12,last_synced_at=$13,sync_status=$14,storage_used=$15,source_config=$16,storage_config=$17,
        revision=$18,updated_at=$20
      WHERE zook_lighttick_learning_modules.revision=$21`,
      [
        r.appId,
        r.userId,
        r.id,
        r.title,
        r.description,
        r.enabled,
        r.sourceType,
        r.sourceUrl,
        r.sourcePath,
        r.ownerId || null,
        r.isPublic || false,
        r.subscriberCount || 0,
        r.lastSyncedAt || null,
        r.syncStatus || "idle",
        r.storageUsed || 0,
        r.sourceConfig ? JSON.stringify(r.sourceConfig) : null,
        r.storageConfig ? JSON.stringify(r.storageConfig) : null,
        r.revision,
        r.createdAt,
        r.updatedAt,
        base,
      ],
    );
  }
  async listLearningModuleTemplates() {
    const r = await this.query(
      "SELECT * FROM zook_lighttick_learning_module_templates ORDER BY display_order, id",
      [],
    );
    return r.rows.map((row) => mapRow<LearningModuleTemplate>(row));
  }

  // 新增：用户订阅管理
  async getUserSubscription(o: LightTickOwner) {
    return this.one<UserSubscription>(
      "SELECT * FROM zook_lighttick_user_subscriptions WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );
  }

  async saveUserSubscription(r: UserSubscription) {
    await this.query(
      `INSERT INTO zook_lighttick_user_subscriptions(
        app_id, user_id, plan_id, status,
        current_period_start, current_period_end, cancel_at_period_end,
        payment_method_type, payment_method_last4,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT(app_id, user_id) DO UPDATE SET
        plan_id=$3, status=$4,
        current_period_start=$5, current_period_end=$6, cancel_at_period_end=$7,
        payment_method_type=$8, payment_method_last4=$9,
        updated_at=$11`,
      [
        "lighttick",
        r.userId,
        r.planId,
        r.status,
        r.currentPeriodStart,
        r.currentPeriodEnd,
        r.cancelAtPeriodEnd,
        r.paymentMethod?.type || null,
        r.paymentMethod?.last4 || null,
        r.createdAt,
        r.updatedAt,
      ],
    );
  }

  // 新增：存储使用统计
  async getStorageUsage(o: LightTickOwner): Promise<StorageUsage> {
    const totalR = await this.query(
      "SELECT COALESCE(SUM(storage_used), 0)::bigint AS total_used FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );

    const modulesR = await this.query(
      "SELECT COUNT(*)::int AS count, COALESCE(SUM(storage_used), 0)::bigint AS size FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );

    const lessonsR = await this.query(
      "SELECT COUNT(*)::int AS count, 0::bigint AS size FROM zook_lighttick_native_lessons WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );

    const docsR = await this.query(
      "SELECT COUNT(*)::int AS count, COALESCE(SUM(size), 0)::bigint AS size FROM zook_lighttick_content_documents WHERE app_id=$1 AND user_id=$2",
      [o.appId, o.userId],
    );

    const topModulesR = await this.query(
      "SELECT id, title, storage_used AS size FROM zook_lighttick_learning_modules WHERE app_id=$1 AND user_id=$2 ORDER BY storage_used DESC LIMIT 5",
      [o.appId, o.userId],
    );

    const totalUsed = Number(totalR.rows[0]?.total_used || 0);
    // 默认免费套餐 500MB
    const totalLimit = 500 * 1024 * 1024;

    return {
      userId: o.userId,
      totalUsed,
      totalLimit,
      percentage: Math.round((totalUsed / totalLimit) * 100),
      breakdown: {
        modules: {
          count: Number(modulesR.rows[0]?.count || 0),
          size: Number(modulesR.rows[0]?.size || 0),
        },
        lessons: {
          count: Number(lessonsR.rows[0]?.count || 0),
          size: Number(lessonsR.rows[0]?.size || 0),
        },
        attachments: {
          count: Number(docsR.rows[0]?.count || 0),
          size: Number(docsR.rows[0]?.size || 0),
        },
        versions: { count: 0, size: 0 },
      },
      topModules: topModulesR.rows.map((row) => ({
        moduleId: String(row.id),
        title: String(row.title),
        size: Number(row.size),
      })),
      updatedAt: new Date().toISOString(),
    };
  }

  // 新增：存储配置管理
  async getUserStorage(o: LightTickOwner, id: string) {
    return this.one<StorageConfig>(
      "SELECT config FROM zook_lighttick_user_storage WHERE id=$1 AND app_id=$2 AND user_id=$3",
      [id, o.appId, o.userId],
    );
  }

  async listUserStorage(o: LightTickOwner): Promise<StorageConfig[]> {
    const r = await this.query(
      "SELECT config FROM zook_lighttick_user_storage WHERE app_id=$1 AND user_id=$2 ORDER BY is_default DESC, created_at DESC",
      [o.appId, o.userId],
    );
    return r.rows.map((row) => mapRow<StorageConfig>(row));
  }

  async saveUserStorage(r: StorageConfig) {
    await this.query(
      `INSERT INTO zook_lighttick_user_storage(
        app_id, user_id, storage_type, config, is_default, status
      ) VALUES ('lighttick', $1, $2, $3, $4, 'active')
      ON CONFLICT(app_id, user_id, storage_type) DO UPDATE SET
        config=$3, is_default=$4, updated_at=NOW()`,
      [
        // @ts-expect-error - StorageConfig has userId at runtime
        r.userId,
        r.type,
        JSON.stringify(r),
        // @ts-expect-error - isDefault is optional
        r.isDefault || false,
      ],
    );
  }

  async deleteUserStorage(o: LightTickOwner, id: string) {
    await this.query(
      "DELETE FROM zook_lighttick_user_storage WHERE id=$1 AND app_id=$2 AND user_id=$3",
      [id, o.appId, o.userId],
    );
  }
}
