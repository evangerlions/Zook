import { readingFailureCode, readingSourceFailure } from "./reading-failure.ts";
import { Worker } from "node:worker_threads";
import type { ReadingDocument } from "./reading-collection.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import { fail } from "../learning/native-learning.validation.ts";
export async function parseReadingDocument(
  work: Pick<ReadingWork, "kind" | "input">,
  document: ReadingDocument,
  signal: AbortSignal,
): Promise<NonNullable<ReadingWork["output"]>> {
  signal.throwIfAborted();
  const worker = new Worker(
    new URL("./reading-parse.thread.ts", import.meta.url),
    {
      workerData: { work, document },
      resourceLimits: {
        maxOldGenerationSizeMb: 192,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    },
  );
  let aborted!: () => void;
  try {
    return await new Promise((resolve, reject) => {
      aborted = () => reject(signal.reason ?? Error("READING_CANCELLED"));
      signal.addEventListener("abort", aborted, { once: true });
      if (signal.aborted) aborted();
      worker.once("message", (message) => {
        if (message?.ok) resolve(message.result);
        else
          try {
            const code = readingFailureCode(message);
            if (code)
              readingSourceFailure(code, message.status === 413 ? 413 : 422);
            fail(
              message?.status === 413 ? 413 : 422,
              "来源文本无法解析或超出容量，未导入部分结果。",
            );
          } catch (error) {
            reject(error);
          }
      });
      worker.once("error", () =>
        reject(
          Object.assign(Error("Source parser failed"), { statusCode: 422 }),
        ),
      );
      worker.once("exit", () =>
        reject(
          Object.assign(Error("Source parser ended before a result"), {
            statusCode: 422,
          }),
        ),
      );
    });
  } finally {
    signal.removeEventListener("abort", aborted);
    await worker.terminate();
  }
}
