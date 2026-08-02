export class LlmCallerCancelledError extends Error {
  constructor(
    readonly reason?: unknown,
    options?: { cause?: unknown },
  ) {
    super("LLM request cancelled by caller.", {
      ...(options?.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "LlmCallerCancelledError";
  }
}

export function isLlmCallerCancelledError(
  error: unknown,
): error is LlmCallerCancelledError {
  return error instanceof LlmCallerCancelledError;
}

export class LlmCallerCancellationScope {
  private readonly controller = new AbortController();
  private readonly abortFromCaller = () =>
    this.controller.abort(this.callerSignal?.reason);

  constructor(private readonly callerSignal?: AbortSignal) {
    if (callerSignal?.aborted) {
      this.abortFromCaller();
    } else {
      callerSignal?.addEventListener("abort", this.abortFromCaller, {
        once: true,
      });
    }
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  abort(reason: unknown): void {
    this.controller.abort(reason);
  }

  rethrow(error: unknown): never {
    if (this.callerSignal?.aborted) {
      throw new LlmCallerCancelledError(this.callerSignal.reason, {
        cause: error,
      });
    }
    throw error;
  }

  dispose(incompleteReason?: unknown): void {
    this.callerSignal?.removeEventListener("abort", this.abortFromCaller);
    if (incompleteReason !== undefined && !this.signal.aborted) {
      this.abort(incompleteReason);
    }
  }
}
