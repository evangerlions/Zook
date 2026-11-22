import type { LightTickOwner } from "../lighttick.types.ts";
import { LEARNING_WORK_LIMITS, type LearningWorkService } from "./learning-work.service.ts";
import type { LearningWork } from "./learning-work.types.ts";
import { learningWorkContextCurrent } from "./learning-work-context.ts";

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
    if (!await learningWorkContextCurrent(service, work)) {
      failure = "LEARNING_CONTEXT_STALE";
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
