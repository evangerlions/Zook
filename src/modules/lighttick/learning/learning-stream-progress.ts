export interface StreamProgressValue {
  received_chars: number;
  lesson_count_so_far: number;
}
export interface ProgressCoalescer {
  /** Feed the accumulated document; never throws, never awaits. */
  text(full: string): void;
  /** Flush the last pending value and stop accepting new ones. */
  close(): Promise<void>;
}
/**
 * Index of the `[` that opens the top-level `"lessons"` array, or -1.
 *
 * Scans without allocating and without `JSON.parse`, so an arbitrary truncated
 * prefix is safe input. `keyIsLessons` is recomputed on every string that closes
 * at depth 1, otherwise a *value* string spelled "lessons" (e.g. inside
 * `prerequisites`) would leave the flag set and match an unrelated array.
 */
function lessonsArrayIndex(text: string): number {
  let depth = 0,
    inString = false,
    escaped = false,
    key = "",
    keyIsLessons = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = false;
        keyIsLessons = depth === 1 && key === "lessons";
        key = "";
      } else key += c;
      continue;
    }
    if (c === '"') {
      inString = true;
      key = "";
      continue;
    }
    if (c === "[") {
      if (keyIsLessons) return i;
      depth++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}" || c === "]") depth--;
  }
  return -1;
}
/**
 * Count lesson objects that are complete, starting at the `[` of the array.
 * A lesson counts only when its `}` returns the scan to array depth, so a
 * half-streamed object is never counted.
 */
function countObjects(text: string, start: number): number {
  let depth = 0,
    inString = false,
    escaped = false,
    count = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === "\\") {
        escaped = true;
        continue;
      }
      if (c === '"') inString = false;
      continue;
    }
    if (c === '"') {
      inString = true;
      continue;
    }
    if (c === "[" || c === "{") {
      depth++;
      continue;
    }
    if (c === "]" || c === "}") {
      depth--;
      if (depth <= 0) return count;
      if (c === "}" && depth === 1) count++;
    }
  }
  return count;
}
/** Progress derivable from a partial JSON document. Never throws. */
export function streamProgress(text: string): StreamProgressValue {
  if (typeof text !== "string")
    return { received_chars: 0, lesson_count_so_far: 0 };
  const start = lessonsArrayIndex(text);
  return {
    received_chars: text.length,
    lesson_count_so_far: start < 0 ? 0 : countObjects(text, start),
  };
}
/**
 * Coalesces per-token progress into at most one in-flight write, throttled to
 * `flushMs`, with an immediate write whenever the lesson count advances.
 * `text()` is fire-and-forget: a slow database must never stall the model stream.
 */
export function createProgressCoalescer(options: {
  write: (value: StreamProgressValue) => Promise<void>;
  flushMs?: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): ProgressCoalescer {
  const flushMs = options.flushMs ?? 800,
    now = options.now ?? (() => Date.now()),
    setTimer =
      options.setTimer ??
      ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown),
    clearTimer = options.clearTimer ?? ((h: unknown) => clearTimeout(h as any));
  let latest: StreamProgressValue | null = null,
    observed = 0,
    lastAt = 0,
    timer: unknown = null,
    running: Promise<void> | null = null,
    closed = false;
  const stopTimer = () => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };
  const pump = (): Promise<void> => {
    if (running) return running;
    running = (async () => {
      try {
        while (latest) {
          const value = latest;
          latest = null;
          lastAt = now();
          await options.write(value).catch(() => {});
        }
      } finally {
        running = null;
      }
    })();
    return running;
  };
  const arm = () => {
    if (closed || timer !== null || running) return;
    const wait = Math.max(0, flushMs - (now() - lastAt));
    timer = setTimer(() => {
      timer = null;
      void pump();
    }, wait);
  };
  return {
    text(full: string) {
      if (closed) return;
      const value = streamProgress(full),
        advanced = value.lesson_count_so_far > observed;
      observed = Math.max(observed, value.lesson_count_so_far);
      latest = value;
      if (advanced || now() - lastAt >= flushMs) {
        stopTimer();
        void pump();
        return;
      }
      arm();
    },
    async close() {
      closed = true;
      stopTimer();
      if (latest) await pump();
      else if (running) await running;
    },
  };
}
