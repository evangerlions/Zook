import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { LearningCompletion } from "../../../modules/lighttick/learning/learning-review.types.ts";
type Query = (
  sql: string,
  args: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresLearningReviewStore {
  constructor(private readonly query: Query) {}
  async list(
    o: LightTickOwner,
    includePrivate: boolean,
  ): Promise<LearningCompletion[]> {
    const result = await this.query(
      `WITH completions AS (
      SELECT lesson_id,content_version,completed_at FROM zook_lighttick_native_learning_private
      WHERE app_id=$1 AND user_id=$2 AND $3 AND completed
      UNION ALL
      SELECT l.id,l.source_completed_version,NULL::timestamptz FROM zook_lighttick_native_lessons l
      WHERE l.app_id=$1 AND l.user_id=$2 AND l.source_completed AND l.source_completed_version IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM zook_lighttick_native_learning_private p WHERE p.app_id=l.app_id AND p.user_id=l.user_id
        AND p.lesson_id=l.id AND p.content_version=l.source_completed_version AND $3 AND p.completed)
    ) SELECT s.lesson_id,s.content_version,s.completed_at,l.title,
      CASE WHEN COALESCE(l.module_id,c.module_id) IS NOT NULL THEN 'module/'||COALESCE(l.module_id,c.module_id)
        WHEN r.id IS NOT NULL THEN 'courses' ELSE 'unassigned' END AS module,
      COALESCE(m.title,t.title,COALESCE(l.module_id,c.module_id),CASE WHEN r.id IS NOT NULL THEN '课程规划' ELSE '未分类课程' END) AS module_label,
      NOT l.archived AND NOT c.archived AND l.published_version IS NOT NULL AS available,
      s.content_version=l.published_version AS is_current
      FROM completions s
      JOIN zook_lighttick_native_lessons l ON l.app_id=$1 AND l.user_id=$2 AND l.id=s.lesson_id
      JOIN zook_lighttick_learning_collections c ON c.app_id=l.app_id AND c.user_id=l.user_id AND c.id=l.collection_id
      LEFT JOIN zook_lighttick_learning_modules m ON m.app_id=l.app_id AND m.user_id=l.user_id AND m.id=COALESCE(l.module_id,c.module_id)
      LEFT JOIN zook_lighttick_learning_module_templates t ON t.id=COALESCE(l.module_id,c.module_id)
      LEFT JOIN zook_lighttick_learning_routes r ON r.app_id=l.app_id AND r.user_id=l.user_id AND r.id=l.collection_id
      ORDER BY s.lesson_id COLLATE "C",s.content_version COLLATE "C" LIMIT 5001`,
      [o.appId, o.userId, includePrivate],
    );
    return result.rows.map((row) => ({
      lesson_id: String(row.lesson_id),
      content_version: String(row.content_version),
      title: String(row.title),
      module: String(row.module),
      module_label: String(row.module_label),
      completed_at:
        row.completed_at instanceof Date
          ? row.completed_at.toISOString()
          : row.completed_at
            ? String(row.completed_at)
            : null,
      available: row.available === true,
      is_current: row.is_current === true,
    }));
  }
}
