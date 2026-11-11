import { readingFailureCode } from "./reading-failure.ts";
import type { ReadingWork } from "./reading-work.types.ts";
import { parentPort, workerData } from "node:worker_threads";
import {
  extractReadingFullText,
  readingDocumentBytes,
} from "./reading-fulltext.ts";
import { createHash } from "node:crypto";
import { collectReadingDocument } from "./reading-collection.ts";
// PDF only reads selected bytes and bundled font assets.
globalThis.fetch = async () => {
  throw Error("READING_PARSER_NETWORK_DISABLED");
};
// CPU work only. The parser receives selected source data, never account credentials.
try {
  const { work, document } = workerData;
  let result: NonNullable<ReadingWork["output"]>;
  if (work.input.format === "article") {
    const body = await extractReadingFullText(
      document,
      work.kind === "fetch_full" ? 100 : 1,
    );
    result = collectReadingDocument(work, { body, content_type: "text/plain" });
    result.document = {
      ...document,
      url: work.input.url,
      sha256: createHash("sha256")
        .update(readingDocumentBytes(document))
        .digest("hex"),
      capture_kind:
        work.kind === "fetch_full"
          ? "full_fetch"
          : document.encoding === "base64"
            ? "pdf_text"
            : "web_text",
      extraction_version:
        document.encoding === "base64"
          ? "pdfjs-6.5.438/lighttick-text-v1"
          : /html/.test(document.content_type)
            ? "readability-0.6.0/linkedom-0.18.15/lighttick-text-v1"
            : "plain-text/lighttick-text-v1",
    };
  } else result = collectReadingDocument(work, document);
  parentPort!.postMessage({ ok: true, result });
} catch (error: any) {
  parentPort!.postMessage({
    ok: false,
    status: error?.statusCode === 413 ? 413 : 422,
    code: readingFailureCode(error),
  });
}
