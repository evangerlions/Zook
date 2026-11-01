import { LlmCallerCancellationScope } from "./llm-caller-cancellation.ts";

export async function executeCancellableEmbedding<T>(
  callerSignal: AbortSignal | undefined,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const scope = new LlmCallerCancellationScope(callerSignal);
  const signal = timeoutMs > 0
    ? AbortSignal.any([scope.signal, AbortSignal.timeout(timeoutMs)]) : scope.signal;
  try {
    if (signal.aborted) throw signal.reason;
    const result = await work(signal);
    if (signal.aborted) throw signal.reason;
    return result;
  } catch (error) {
    scope.rethrow(error);
  } finally {
    scope.dispose();
  }
}
