import { PROVIDER_QUERY_TIMEOUT_MS } from "./membership-sync.ts";
/** Per-query deadline, never a whole-membership deadline. Late evidence is discarded. */
export async function providerQuery<T>(work: (signal: AbortSignal) => Promise<T>, parent?: AbortSignal, timeoutMs = PROVIDER_QUERY_TIMEOUT_MS): Promise<T> {
  const timeout = new AbortController();
  const signal = parent ? AbortSignal.any([parent, timeout.signal]) : timeout.signal;
  signal.throwIfAborted();
  const timer = setTimeout(() => timeout.abort(new Error("Provider query timed out")), timeoutMs);
  let abort: () => void = () => {};
  try {
    const result = await Promise.race([work(signal), new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
    signal.throwIfAborted();
    return result;
  } finally { clearTimeout(timer); signal.removeEventListener("abort", abort); }
}
