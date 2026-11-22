import type { LightTickOwner } from "../lighttick.types.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LearningRouteRepository } from "./learning-route.types.ts";
import type { LearningAuthority } from "./native-learning.types.ts";
import { STRUCTURED_THINKING } from "./tutor-material.ts";

type ProgressFacts = Awaited<ReturnType<LearningRouteRepository["readRouteProgressFacts"]>>;
type CompletionAuthority = Pick<LearningAuthority, "privateEnabled" | "consentRevision">;

export async function tutorFollowupPrerequisite(repository: LightTickRepository, owner: LightTickOwner, routeId: string,
  authority: CompletionAuthority, observedFacts?: ProgressFacts) {
  const facts = observedFacts ?? await repository.learningRoutes.readRouteProgressFacts(owner, routeId);
  const first = facts.find(fact => fact.number === 1);
  if (facts.length !== 1 || !first || !(first.sourceCompleted || (authority.privateEnabled && first.completed))) return;
  const lesson = await repository.getNativeLesson(owner, first.lessonId);
  if (!lesson || lesson.archived || lesson.collectionId !== routeId || lesson.publishedVersion !== first.contentVersion) return;
  if ((await repository.getLearningCollection(owner, routeId))?.archived !== false) return;
  const publication = await repository.getLessonPublication(owner, first.lessonId, first.contentVersion);
  if (publication?.tutorTopic !== STRUCTURED_THINKING) return;
  return { lesson_id: first.lessonId, content_version: first.contentVersion,
    consent_revision: first.sourceCompleted ? null : authority.consentRevision ?? 0 };
}

export async function tutorFollowupPrerequisiteCurrent(repository: LightTickRepository, owner: LightTickOwner,
  routeId: string, authority: CompletionAuthority, expected: unknown) {
  if (!expected || typeof expected !== "object") return false;
  const actual = await tutorFollowupPrerequisite(repository, owner, routeId, authority);
  const pin = expected as Partial<NonNullable<Awaited<ReturnType<typeof tutorFollowupPrerequisite>>>>;
  return !!actual && actual.lesson_id === pin.lesson_id && actual.content_version === pin.content_version
    && actual.consent_revision === pin.consent_revision;
}
