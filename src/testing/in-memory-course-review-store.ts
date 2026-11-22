import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type {
  CourseFeedback,
  CourseReviewStore,
} from "../modules/lighttick/course-review/course-review.types.ts";
import { ApplicationError } from "../shared/errors.ts";
export class InMemoryCourseReviewStore implements CourseReviewStore {
  private rows = new Map<
    string,
    { owner: LightTickOwner; collection: string; row: CourseFeedback }
  >();
  async list(o: LightTickOwner, collection: string) {
    return structuredClone(
      [...this.rows.values()]
        .filter(
          (v) =>
            v.owner.appId === o.appId &&
            v.owner.userId === o.userId &&
            v.collection === collection,
        )
        .map((v) => v.row),
    );
  }
  async save(
    o: LightTickOwner,
    collection: string,
    row: CourseFeedback,
    base: number,
  ) {
    const key = JSON.stringify([
      o.appId,
      o.userId,
      collection,
      row.lesson_id,
      row.content_version,
    ]);
    if ((this.rows.get(key)?.row.revision ?? 0) !== base)
      throw new ApplicationError(
        409,
        "LIGHTTICK_VERSION_CONFLICT",
        "课程反馈已变化。",
      );
    this.rows.set(key, structuredClone({ owner: o, collection, row }));
  }
  snapshot() {
    return structuredClone([...this.rows]);
  }
  restore(v: ReturnType<InMemoryCourseReviewStore["snapshot"]>) {
    this.rows = new Map(v);
  }
  deleteOwner(o: LightTickOwner) {
    for (const [k, v] of this.rows)
      if (v.owner.appId === o.appId && v.owner.userId === o.userId)
        this.rows.delete(k);
  }
}
