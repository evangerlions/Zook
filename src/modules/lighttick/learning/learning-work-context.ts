import type { LearningWorkService } from "./learning-work.service.ts";
import { isPrivateLearningWork, type LearningWork } from "./learning-work.types.ts";
import { TutorObservations } from "./tutor-observations.ts";
import { scheduleSuggestionCurrent } from "./learning-schedule-suggestion.ts";

export async function learningWorkContextCurrent(service: LearningWorkService, work: LearningWork) {
  const { repository } = service.native;
  const authority = await repository.getLearningAuthority(work);
  if (!service.native.enabled || !authority?.readingEnabled || authority.phase !== "zook" ||
    authority.epoch !== work.epoch || (isPrivateLearningWork(work.kind) && !authority.privateEnabled)) {
    return false;
  }
  if (work.kind === "report_review") return true;

  const route = await repository.learningRoutes.getLearningRoute(work, work.routeId);
  if ((route?.revision ?? 0) !== work.baseRouteRevision || route?.status === "archived") return false;
  if (work.kind === "schedule_draft") {
    return route?.status === "active" && service.scheduleSuggestionsEnabled() &&
      work.input.consent_revision === (authority.consentRevision ?? 0) && await scheduleSuggestionCurrent(service.native, work);
  }
  if (work.kind === "route_refine") {
    return route?.status === "active" && route.publishedVersion === work.input.base_version &&
      service.routeRefinementEnabled() && (!work.input.observation_source ||
        (work.input.consent_revision === (authority.consentRevision ?? 0) &&
        !!await new TutorObservations(service).refinementSummary(work, work.routeId, work.input.observation_source)));
  }
  if ((work.kind === "tutor_turn" || work.input.tutor_topic !== undefined) && !service.tutorEnabled()) return false;
  if (work.kind !== "tutor_turn") return true;

  const input = work.input;
  if (route?.status !== "active" || input.consent_revision !== (authority.consentRevision ?? 0)) return false;
  const lesson = await repository.getNativeLesson(work, input.lesson_id);
  if (!lesson || lesson.archived || lesson.collectionId !== work.routeId || lesson.publishedVersion !== input.content_version) {
    return false;
  }
  if (input.observation_revision !== undefined) {
    const observation = await new TutorObservations(service).snapshot(work, input.lesson_id, input.content_version);
    if (observation?.revision !== input.observation_revision) return false;
  }
  if (input.action !== "feedback") return true;
  if (!Number.isInteger(input.answer_revision) || typeof input.submission !== "string") return false;
  const state = await repository.getNativePrivateState(work, input.lesson_id, input.content_version);
  const answer = state?.answers.find(entry => entry.id === input.material?.question?.id);
  return state?.notesRevision === input.answer_revision && answer?.answer === input.submission;
}
