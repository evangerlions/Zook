import type { LightTickOwner } from "../lighttick.types.ts";
import { validateScheduleSuggestion } from "./learning-schedule-suggestion.ts";
import { LEARNING_WORK_LIMITS, type LearningWorkService } from "./learning-work.service.ts";
import { isPrivateLearningWork, type LearningWork } from "./learning-work.types.ts";
import { TutorObservations } from "./tutor-observations.ts";

export async function checkTutorWork(service: LearningWorkService, work: LearningWork) {
  const { repository: repo } = service.native;
  const input = work.input;
  const lesson = await repo.getNativeLesson(work, input.lesson_id);
  if (!service.scheduleSuggestionsEnabled() ||
    !lesson || lesson.archived || lesson.publishedVersion !== input.content_version) throw Error('LEARNING_CONTEXT_STALE');
  if (input.observation_revision !== undefined) await new TutorObservations(service).assertCurrent(work);
  if (input.answer_revision !== undefined) {
    const state = await repo.getNativePrivateState(work, input.lesson_id, input.content_version);
    if (state?.notesRevision !== input.answer_revision) throw Error('LEARNING_CONTEXT_STALE');
  }
}

export async function finalizeLearningWork(
  service: LearningWorkService,
  work: LearningWork,
  output: LearningWork["output"],
  failure: string | null,
  authorizeOwner: (owner: LightTickOwner) => Promise<void>,
) {
  const { appId, userId } = work;
  const owner = { appId, userId };
  const { native, store } = service;
  const { repository: repo } = native;
  return repo.transaction(owner, async () => {
    const current = await store.get(owner, work.id);
    if (!current || current.status !== "running" || current.fence !== work.fence) return current;
    try {
      await authorizeOwner(owner);
    } catch {
      failure = "LEARNING_CONTEXT_STALE";
    }
    if (current.leaseUntil! <= native.clock().toISOString()) return current;

    // A newer owner transaction may withdraw consent after the network call finished.
    const authority = await repo.getLearningAuthority(owner);
    const route = await repo.learningRoutes.getLearningRoute(owner, work.routeId);
    const privateConsentStale = isPrivateLearningWork(work.kind) &&
      (!authority?.privateEnabled || (authority.consentRevision ?? 0) !== work.input.consent_revision);
    const routeStale = work.kind !== "report_review" &&
      ((route?.revision ?? 0) !== work.baseRouteRevision || route?.status === "archived");
    if (!authority?.readingEnabled || privateConsentStale || authority.phase !== "zook" ||
      authority.epoch !== work.epoch || routeStale) {
      failure = "LEARNING_CONTEXT_STALE";
    }
    if (!failure && work.kind === "tutor_turn" && authority) {
      try {
        await checkTutorWork(service, work);
      } catch {
        failure = "LEARNING_CONTEXT_STALE";
      }
    }
    if (!failure && output && work.kind === "schedule_draft") {
      if (!service.scheduleSuggestionsEnabled()) failure = "LEARNING_CONTEXT_STALE";
      else {
        try {
          await validateScheduleSuggestion(native, work, output);
        } catch (error: any) {
          failure = error?.statusCode === 422 ? "LEARNING_OUTPUT_INVALID" : "LEARNING_CONTEXT_STALE";
        }
      }
    }
    const retry = work.kind !== "tutor_turn" && work.input.model_selection?.mode !== "personal" &&
      (failure === "LEARNING_PROVIDER_UNAVAILABLE" || failure === "LEARNING_TIMEOUT") &&
      current.attempt < LEARNING_WORK_LIMITS.attempts;
    const next: LearningWork = {
      ...current,
      revision: current.revision + 1,
      status: retry ? "queued" : failure ? "failed" : "succeeded",
      fence: null,
      leaseUntil: null,
      output: failure ? null : output,
      errorCode: failure,
      updatedAt: native.clock().toISOString(),
    };
    await store.save(next, current.revision);
    return next;
  });
}
