import type { AiNovelCreditsService } from "./ai-novel-credits.service.ts";

/** Renew a live request's account ownership; a crashed process stops renewing. */
export function startCreditsRequestLease(
  credits: AiNovelCreditsService,
  userId: string,
  jobId: string,
  requestId: string,
  upstreamSignal?: AbortSignal,
  intervalMs = 60_000,
) {
  const controller = new AbortController();
  const signal = upstreamSignal ? AbortSignal.any([upstreamSignal, controller.signal]) : controller.signal;
  let renewing = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (renewing || stopped || signal.aborted) return;
    renewing = true;
    void credits.renewRequest(userId, jobId, requestId)
      .catch((error: unknown) => { if (!stopped) controller.abort(error); })
      .finally(() => { renewing = false; });
  }, intervalMs);
  timer.unref();
  return { signal, stop() { stopped = true; clearInterval(timer); } };
}
