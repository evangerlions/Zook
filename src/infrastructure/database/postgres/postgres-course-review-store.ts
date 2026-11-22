import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type {
  CourseFeedback,
  CourseReviewStore,
} from "../../../modules/lighttick/course-review/course-review.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
type Query = (
  sql: string,
  args: unknown[],
) => Promise<{ rows: Record<string, unknown>[] }>;
export class PostgresCourseReviewStore implements CourseReviewStore {
  constructor(private readonly query: Query) {}
  async list(o: LightTickOwner, id: string) {
    return (
      await this.query(
        "SELECT data FROM zook_lighttick_course_feedback WHERE app_id=$1 AND user_id=$2 AND collection_id=$3 ORDER BY lesson_id,content_version LIMIT 5001",
        [o.appId, o.userId, id],
      )
    ).rows.map((r) => r.data as CourseFeedback);
  }
  async save(o: LightTickOwner, id: string, row: CourseFeedback, base: number) {
    const args = [
      o.appId,
      o.userId,
      id,
      row.lesson_id,
      row.content_version,
      row.revision,
      JSON.stringify(row),
    ];
    const r =
      base === 0
        ? await this.query(
            "INSERT INTO zook_lighttick_course_feedback VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) ON CONFLICT DO NOTHING RETURNING revision",
            args,
          )
        : await this.query(
            "UPDATE zook_lighttick_course_feedback SET revision=$6,data=$7::jsonb WHERE app_id=$1 AND user_id=$2 AND collection_id=$3 AND lesson_id=$4 AND content_version=$5 AND revision=$8 RETURNING revision",
            [...args, base],
          );
    if (!r.rows.length)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "课程反馈已变化。",
      );
  }
}
