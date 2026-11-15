import type { LightTickOwner } from "../lighttick.types.ts";
import type { LearningWork } from "../learning/learning-work.types.ts";
import {
  LearningWorkService,
  LEARNING_WORK_LIMITS,
} from "../learning/learning-work.service.ts";
import { captureModel } from "../personal-model/personal-model.service.ts";
import {
  collectionIdentity,
  identity,
  integer,
  text,
  keys,
  version,
  digest,
  fail,
} from "../learning/native-learning.validation.ts";
import type { CourseFeedback } from "./course-review.types.ts";
export class CourseReviewService {
  constructor(readonly work: LearningWorkService) {}
  get native() {
    return this.work.native;
  }
  get repo() {
    return this.native.repository;
  }
  async access(o: LightTickOwner) {
    const a = await this.native.requireActive(o);
    if (!a.readingEnabled || !a.privateEnabled)
      fail(403, "Reading and private feedback consent are required.");
    return a;
  }
  async course(o: LightTickOwner, id: string) {
    await this.access(o);
    const c = await this.repo.getLearningCollection(o, collectionIdentity(id));
    if (!c) fail(404, "Course was not found.");
    return c;
  }
  async read(o: LightTickOwner, id: string) {
    return this.repo.transaction(o, async () => {
      const c = await this.course(o, id),
        lessons = await this.repo.listNativeLessons(o, "", 365, id),
        feedback = await this.repo.courseReview.list(o, id);
      if (lessons.length > 364 || feedback.length > 5000)
        fail(413, "Course review exceeds retained projection capacity.");
      const items = [];
      for (const l of lessons) {
        if (l.archived || !l.publishedVersion) continue;
        const s = await this.repo.getNativePrivateState(
          o,
          l.id,
          l.publishedVersion,
        );
        items.push({
          lesson_id: l.id,
          content_version: l.publishedVersion,
          number: l.number,
          title: l.title,
          completed:
            !!s?.completed ||
            (!!l.sourceCompleted &&
              l.sourceCompletedVersion === l.publishedVersion),
          completed_at: s?.completed ? s.completedAt : null,
          feedback:
            feedback.find(
              (f) =>
                f.lesson_id === l.id &&
                f.content_version === l.publishedVersion,
            ) ?? null,
        });
      }
      const route = await this.repo.learningRoutes.getLearningRoute(o, id),
        formal = route?.publishedVersion
          ? await this.repo.learningRoutes.getLearningRouteVersion(
              o,
              id,
              route.publishedVersion,
            )
          : undefined;
      return {
        total_lessons: Math.max(
          items.length,
          formal?.document.lessons.length ?? 0,
        ),
        route_version: formal?.version ?? null,
        id: c.id,
        title: c.title,
        revision: c.revision,
        archived: c.archived,
        lessons: items,
        completed_lessons: items.filter((i) => i.completed).length,
      };
    });
  }
  feedback(
    o: LightTickOwner,
    id: string,
    lessonId: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    keys(b, [
      "base_revision",
      "content_version",
      "mastery_level",
      "value_rating",
      "feeling_tags",
      "key_learnings",
      "questions",
      "next_direction",
    ]);
    const v = version(b.content_version),
      base = integer(b.base_revision, 0, 2147483646);
    if (
      ![
        "fully_understood",
        "basically_understood",
        "partially_understood",
        "not_understood",
      ].includes(String(b.mastery_level))
    )
      fail(422, "Self-rating is invalid.");
    if (!Array.isArray(b.feeling_tags) || b.feeling_tags.length > 10)
      fail(422, "At most ten feeling labels.");
    const data = {
      mastery_level: b.mastery_level as CourseFeedback["mastery_level"],
      value_rating: integer(b.value_rating, 0, 3),
      feeling_tags: b.feeling_tags.map((v) => text(v, 40, true)),
      key_learnings: text(b.key_learnings, 2000),
      questions: text(b.questions, 2000),
      next_direction: text(b.next_direction, 2000),
    };
    return this.native.command(
      o,
      key,
      "private:course-feedback",
      identity(lessonId, "lesson-"),
      { ...b, collection_id: id },
      async () => {
        const c = await this.course(o, id),
          l = await this.repo.getNativeLesson(o, lessonId);
        if (
          c.archived ||
          !l ||
          l.archived ||
          l.collectionId !== id ||
          l.publishedVersion !== v
        )
          fail(
            409,
            "Review the current course/lesson version before saving feedback.",
          );
        const row: CourseFeedback = {
          lesson_id: lessonId,
          content_version: v,
          revision: base + 1,
          ...data,
          updated_at: this.native.clock().toISOString(),
        };
        await this.repo.courseReview.save(o, id, row, base);
        return row;
      },
      authorize,
    );
  }
  async generate(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    keys(b, ["base_revision"]);
    integer(b.base_revision, 1, 2147483646);
    const jobId =
      "work-" + digest([o.appId, o.userId, "course-summary", key]).slice(0, 40);
    const result = await this.native.command(
      o,
      key,
      "private:course-summary",
      jobId,
      { ...b, collection_id: id },
      async (a) => {
        const c = await this.read(o, id);
        if (c.archived || c.revision !== b.base_revision)
          fail(409, "Course changed; reload before summarizing.");
        const lessons = c.lessons.filter((l) => l.completed);
        if (!lessons.length)
          fail(
            422,
            "Explicitly complete a lesson before generating a summary.",
          );
        const facts = {
          version: "course-review-v1",
          collection_id: id,
          title: c.title,
          collection_revision: c.revision,
          total_lessons: c.total_lessons,
          route_version: c.route_version,
          completed_lessons: lessons.length,
          lessons,
          snapshot_at: this.native.clock().toISOString(),
        };
        if (Buffer.byteLength(JSON.stringify(facts)) > 16000)
          fail(
            413,
            "Course feedback exceeds summary capacity; no silent truncation.",
          );
        const now = this.native.clock().toISOString(),
          recent = await this.work.store.recent(
            o,
            now.slice(0, 10) + "T00:00:00.000Z",
          );
        if (
          recent.length >= LEARNING_WORK_LIMITS.dailyJobs ||
          recent.reduce((n, w) => n + w.reservedMicros, 0) + 450000 >
            LEARNING_WORK_LIMITS.dailyEstimatedMicros
        )
          fail(429, "Daily learning budget exhausted.");
        const row: LearningWork = {
          ...o,
          id: jobId,
          routeId: id,
          revision: 1,
          kind: "course_summary",
          status: "queued",
          epoch: a.epoch,
          baseRouteRevision: c.revision,
          input: {
            course_review: facts,
            model_selection: await captureModel(this.repo, o),
          },
          output: null,
          attempt: 0,
          fence: null,
          leaseUntil: null,
          reservedMicros: 450000,
          errorCode: null,
          createdAt: now,
          updatedAt: now,
        };
        await this.work.store.save(row, 0);
        return this.data(row);
      },
      authorize,
    );
    await this.work.dispatch(o, result.id);
    return result;
  }
  data(row: LearningWork) {
    return { ...this.work.data(row), facts: row.input.course_review };
  }
  async summary(o: LightTickOwner, id: string, jobId: string) {
    return this.repo.transaction(o, async () => {
      await this.course(o, id);
      const row = await this.work.store.get(o, identity(jobId, "work-"));
      if (!row || row.kind !== "course_summary" || row.routeId !== id)
        fail(404, "Course summary was not found.");
      return this.data(row);
    });
  }
  async history(
    o: LightTickOwner,
    id: string,
    query: Record<string, string | undefined>,
  ) {
    return this.repo.transaction(o, async () => {
      await this.course(o, id);
      const after = query.after ?? "";
      if (after) identity(after, "work-");
      const rows = await this.work.store.courseSummaries(o, id, after, 11);
      return {
        items: rows.slice(0, 10).map((w) => ({
          ...this.work.data(w),
          output: null,
          output_digest: null,
        })),
        next_cursor: rows.length > 10 ? rows[9].id : null,
      };
    });
  }
  async prepare(
    o: LightTickOwner,
    id: string,
    b: Record<string, unknown>,
    key: string,
    authorize?: () => Promise<void>,
  ) {
    keys(b, ["summary_id", "brief"]);
    await this.access(o);
    const summary = await this.summary(o, id, identity(b.summary_id, "work-"));
    if (summary.status !== "succeeded")
      fail(409, "Review a successful summary first.");
    return this.work.create(
      o,
      {
        kind: "route_draft",
        route_id: "plan-next-" + digest([o.userId, key]).slice(0, 32),
        base_revision: 0,
        brief: b.brief,
        review_id: b.summary_id,
      },
      key,
      authorize,
    );
  }
  async receipt(o: LightTickOwner, key: string) {
    return this.repo.transaction(o, async () => {
      await this.access(o);
      const op = await this.repo.getOperation(o, "learning:" + identity(key));
      if (!op) fail(404, "Course review receipt not found.");
      if (
        !["private:course-summary", "private:course-feedback"].includes(
          op.action,
        )
      ) {
        const work = await this.work.store.get(o, op.entityId);
        if (
          !work ||
          !(
            work.kind === "course_summary" || work.input.course_review_context
          ) ||
          !["work:create", "work:cancel", "work:adopt"].includes(op.action)
        )
          fail(404, "Course review receipt not found.");
      }
      return op.resultPayload;
    });
  }
}
