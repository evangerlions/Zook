/** Await a stage without extending the request's one shared deadline. */
export async function beforeSearchDeadline<T>(pending: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort = () => {};
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    })]);
  } finally { signal.removeEventListener("abort", abort); }
}
