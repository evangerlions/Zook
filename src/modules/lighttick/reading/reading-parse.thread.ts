import { parentPort, workerData } from "node:worker_threads";
import { collectReadingDocument } from "./reading-collection.ts";
// CPU work only. The parser receives selected source data, never account credentials.
try {
  parentPort!.postMessage({
    ok: true,
    result: collectReadingDocument(workerData.work, workerData.document),
  });
} catch (error: any) {
  parentPort!.postMessage({
    ok: false,
    status: error?.statusCode === 413 ? 413 : 422,
  });
}
