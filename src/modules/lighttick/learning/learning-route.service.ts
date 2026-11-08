import type { LightTickOwner } from "../lighttick.types.ts";
import type { NativeLearningService } from "./native-learning.service.ts";
import type { LearningRoute } from "./learning-route.types.ts";
import { courseBrief, courseDocument } from "./learning-route.validation.ts";
import { identity, integer, text, keys, canonical, digest, fail } from "./native-learning.validation.ts";

export class LearningRouteService {
  constructor(readonly native: NativeLearningService) {}
  get repo() { return this.native.repository; }
  async access(owner: LightTickOwner) {
    const a = await this.native.requireActive(owner);
    if (!a.readingEnabled) fail(403, "Reading consent is required.");
    return a;
  }
  routeId(id: unknown) {
    const value = identity(id, "plan-");
    if (value.length > 75 || !/^plan-[a-zA-Z0-9-]+$/.test(value)) fail(422, "Invalid formal course route identity.");
    return value;
  }
  async require(owner: LightTickOwner, id: string) {
    const r = await this.repo.learningRoutes.getLearningRoute(owner, this.routeId(id));
    if (!r) fail(404, "Formal course route was not found.");
    return r;
  }
  data(r: LearningRoute) {
    return { id: r.id, revision: r.revision, published_version: r.publishedVersion, status: r.status,
      brief: r.brief, document: r.document, updated_at: r.updatedAt };
  }
  async list(owner: LightTickOwner, cursor = "", limit = 25) {
    return this.repo.transaction(owner, async () => {
      const a = await this.access(owner); integer(limit, 1, 100);
      const rows = await this.repo.learningRoutes.listLearningRoutes(owner, this.native.position(owner, "routes", cursor, a.revision), limit + 1);
      return { items: rows.slice(0, limit).map(r => this.data(r)), next_cursor: rows.length > limit ? this.native.cursor(owner, "routes", rows[limit - 1].id, a.revision) : null };
    });
  }
  async read(owner: LightTickOwner, id: string, version?: number) {
    return this.repo.transaction(owner, async () => {
      await this.access(owner);
      const r = await this.require(owner, id);
      if (version !== undefined) {
        integer(version, 1, 2147483647);
        const old = await this.repo.learningRoutes.getLearningRouteVersion(owner, id, version);
        if (!old) fail(404, "Published course version was not found.");
        return { id, version: old.version, brief: old.brief, document: old.document, digest: old.digest, created_at: old.createdAt };
      }
      return this.data(r);
    });
  }
  save(owner: LightTickOwner, id: string, b: Record<string, unknown>, key: string, authorize?: () => Promise<void>) {
    this.routeId(id); keys(b, ["base_revision", "brief", "document"]);
    const base = integer(b.base_revision, 0, 2147483646), brief = courseBrief(b.brief), document = courseDocument(b.document, brief);
    return this.native.command(owner, key, "route:save", id, b, async () => {
      const old = await this.repo.learningRoutes.getLearningRoute(owner, id);
      if ((old?.revision ?? 0) !== base || old?.status === "archived") fail(409, "Route changed or was archived; preserve and compare the draft.");
      const row: LearningRoute = { ...owner, id, revision: base + 1, publishedVersion: old?.publishedVersion ?? 0,
        status: old?.status ?? "draft", brief, document, updatedAt: this.native.clock().toISOString() };
      await this.repo.learningRoutes.saveLearningRoute(row, base);
      return this.data(row);
    }, authorize);
  }
  publish(owner: LightTickOwner, id: string, b: Record<string, unknown>, key: string, authorize?: () => Promise<void>) {
    keys(b, ["base_revision"]); this.routeId(id);
    const base = integer(b.base_revision, 1, 2147483646);
    return this.native.command(owner, key, "route:publish", id, b, async () => {
      const r = await this.require(owner, id);
      if (r.revision !== base || r.status === "archived") fail(409, "Route changed or was archived.");
      const old = r.publishedVersion ? await this.repo.learningRoutes.getLearningRouteVersion(owner, id, r.publishedVersion) : undefined;
      const links = await this.repo.learningRoutes.listRouteLessonLinks(owner, id);
      for (const link of links) {
        if (canonical(old?.document.lessons[link.number - 1]) !== canonical(r.document.lessons[link.number - 1])) fail(409, "Every already published lesson blueprint must remain unchanged.");
      }
      const now = this.native.clock().toISOString(), version = r.publishedVersion + 1;
      await this.repo.learningRoutes.insertLearningRouteVersion({ ...owner, routeId: id, version, brief: r.brief, document: r.document, digest: digest({ brief: r.brief, document: r.document }), createdAt: now });
      const collection = await this.repo.getLearningCollection(owner, id);
      if (collection && !old) fail(409, "Collection identity already exists; do not merge unrelated courses.");
      await this.repo.saveLearningCollection({ ...owner, id, title: r.brief.title, revision: (collection?.revision ?? 0) + 1, archived: false, updatedAt: now }, collection?.revision ?? 0);
      const next = { ...r, publishedVersion: version, revision: r.revision + 1, status: r.status === "paused" ? "paused" as const : "active" as const, updatedAt: now };
      await this.repo.learningRoutes.saveLearningRoute(next, r.revision);
      return this.data(next);
    }, authorize);
  }
  transition(owner: LightTickOwner, id: string, b: Record<string, unknown>, key: string, authorize?: () => Promise<void>) {
    keys(b, ["base_revision", "status"]); this.routeId(id);
    const base = integer(b.base_revision, 1, 2147483646), status = text(b.status, 20, true);
    if (!["active", "paused", "archived"].includes(status)) fail(422, "Invalid course status.");
    return this.native.command(owner, key, "route:status", id, b, async () => {
      const r = await this.require(owner, id);
      if (r.revision !== base || r.status === "archived" || !r.publishedVersion || r.status === status) fail(409, "Course status changed or transition is unavailable.");
      const next = { ...r, revision: r.revision + 1, status: status as LearningRoute["status"], updatedAt: this.native.clock().toISOString() };
      if (status === "archived") {
        const c = await this.repo.getLearningCollection(owner, id);
        if (c) await this.repo.saveLearningCollection({ ...c, archived: true, revision: c.revision + 1, updatedAt: next.updatedAt }, c.revision);
      }
      await this.repo.learningRoutes.saveLearningRoute(next, base);
      return this.data(next);
    }, authorize);
  }
  publishLesson(owner: LightTickOwner, id: string, number: number, b: Record<string, unknown>, key: string, authorize?: () => Promise<void>) {
    this.routeId(id); integer(number, 1, 364);
    keys(b, ["base_revision", "lesson_id", "base_lesson_revision", "content", "references", "source_url"]);
    const base = integer(b.base_revision, 1, 2147483646), lessonId = identity(b.lesson_id, "lesson-");
    return this.native.command(owner, key, "route:lesson-publish:" + number, id, b, async () => {
      const r = await this.require(owner, id);
      if (r.revision !== base || r.status !== "active") fail(409, "Course changed or is not active.");
      const v = await this.repo.learningRoutes.getLearningRouteVersion(owner, id, r.publishedVersion), spec = v?.document.lessons[number - 1];
      if (!spec) fail(404, "Lesson blueprint was not published.");
      const links = await this.repo.learningRoutes.listRouteLessonLinks(owner, id), link = links.find(l => l.number === number);
      if (link && link.lessonId !== lessonId) fail(409, "Published lesson identity cannot change.");
      if (!link && (number !== links.length + 1 || await this.repo.getNativeLesson(owner, lessonId))) fail(409, "Publish lessons in order, using a fresh stable lesson ID.");
      const result = await this.native.publish(owner, lessonId, { base_revision: b.base_lesson_revision, collection_id: id, number, title: spec.topic, content: b.content, references: b.references ?? "", source_url: b.source_url ?? "" }, "route-body-" + digest({ key, id, number }).slice(0, 40), authorize, {routeId:id,number});
      if (!link) await this.repo.learningRoutes.insertRouteLessonLink({ ...owner, routeId: id, number, lessonId, routeVersion: r.publishedVersion, firstContentVersion: result.content_version });
      await this.repo.learningRoutes.saveLearningRoute({ ...r, revision: r.revision + 1, updatedAt: this.native.clock().toISOString() }, r.revision);
      return { ...result, route_id: id, route_revision: r.revision + 1 };
    }, authorize);
  }
}
