import { DeferJobError } from "../../infrastructure/queue/job-queue.ts";
/** Process-session state is caller-owned and explicit; domain services keep no live user/job state in fields. */
export interface LightTickWorkerSession {
  readonly readingCapacity: number;
  readonly reading: Map<string, Promise<void>>;
  readonly reportFailure: (key: string, error: unknown) => void;
}
export function createLightTickWorkerSession(
  reportFailure: LightTickWorkerSession["reportFailure"] = () => {},
  readingCapacity = 1,
): LightTickWorkerSession {
  if (
    !Number.isInteger(readingCapacity) ||
    readingCapacity < 1 ||
    readingCapacity > 4
  )
    throw Error("Invalid reading worker capacity");
  return { readingCapacity, reading: new Map(), reportFailure };
}
/** The domain's queued/running row and lease remain durable; only the shared queue delivery is released. */
export function launchReadingWork(
  session: LightTickWorkerSession,
  key: string,
  execute: () => Promise<unknown>,
  failed: (error: unknown) => Promise<void>,
): void {
  if (session.reading.has(key)) return;
  if (session.reading.size >= session.readingCapacity)
    throw new DeferJobError(1000);
  const completion = Promise.resolve()
    .then(execute)
    .then(() => {})
    .catch(async (error) => {
      try {
        await failed(error);
      } finally {
        session.reportFailure(key, error);
      }
    })
    .catch(() => {})
    .finally(() => {
      session.reading.delete(key);
    });
  session.reading.set(key, completion);
}
export async function drainLightTickWorkerSession(
  session: LightTickWorkerSession,
): Promise<void> {
  while (session.reading.size)
    await Promise.allSettled([...session.reading.values()]);
}
