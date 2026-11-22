import { isPrivateLearningWork } from "./learning-work.types.ts";
import type { LearningAuthority } from "./native-learning.types.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, type LearningWorkService } from "./learning-work.service.ts";
import type { LearningWork } from "./learning-work.types.ts";

export async function finalizeLearningWork(
  service: LearningWorkService,
  work: LearningWork,
  output: LearningWork["output"],
  failure: string | null,
  authorizeOwner: (owner: LightTickOwner) => Promise<void>,
  validate?: (authority: LearningAuthority) => Promise<void>,
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
      (!authority?.privateEnabled || (authority.consentRevision ?? 0) !== (work.input.consent_revision ?? 0));
    const routeStale = work.kind !== "report_review" && work.kind !== "course_summary" &&
      ((route?.revision ?? 0) !== work.baseRouteRevision || route?.status === "archived");
    if (!authority?.readingEnabled || privateConsentStale || authority.phase !== "zook" ||
      authority.epoch !== work.epoch || routeStale) {
      failure = "LEARNING_CONTEXT_STALE";
    }
    if (!failure && authority && validate) {
      try { await validate(authority); }
      catch (error) { failure = (error as { statusCode?: number })?.statusCode === 422 ? "LEARNING_OUTPUT_INVALID" : "LEARNING_CONTEXT_STALE"; }
    }
    if (current.leaseUntil! <= native.clock().toISOString()) return current;
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
      ...(current.progress && !retry ? {progress: {
        ...current.progress,
        phase: failure ? "failed" : "done",
        lesson_count_so_far: !failure && Array.isArray(output?.document?.lessons) ? output.document.lessons.length : 0,
        updated_at: native.clock().toISOString(),
      }} : {}),

    };
    await store.save(next, current.revision);
    return next;
  });
}
