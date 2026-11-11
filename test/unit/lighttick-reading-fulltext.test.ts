import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { extractReadingFullText } from "../../src/modules/lighttick/reading/reading-fulltext.ts";
import { parseReadingDocument } from "../../src/modules/lighttick/reading/reading-parser.ts";
import { fetchReadingSource } from "../../src/modules/lighttick/reading/reading-fetch.ts";
import {
  fetchPublicSourceBytes,
  fetchLearningSource,
} from "../../src/modules/lighttick/learning/learning-sources.ts";
import { readingPdfFixture } from "../support/reading-pdf-fixture.ts";
const work = {
  kind: "fetch_full" as const,
  input: {
    url: "https://example.com/article",
    title: "Selected original",
    format: "article" as const,
  },
};
test("PDF bytes are retained exactly while bounded text extraction runs outside the API event loop", async () => {
  const encrypted = await readFile(
    new URL("../fixtures/reading/encrypted-synthetic.pdf", import.meta.url),
  );
  await assert.rejects(
    extractReadingFullText({
      body: encrypted.toString("base64"),
      encoding: "base64",
      content_type: "application/pdf",
    }),
    { code: "READING_PDF_ENCRYPTED" },
  );
  const bytes = readingPdfFixture(),
    document = {
      body: bytes.toString("base64"),
      encoding: "base64" as const,
      content_type: "application/pdf",
      resolved_url: "https://example.com/document.pdf",
    };
  let responsive = false;
  const timer = setTimeout(() => (responsive = true), 0);
  const result = await parseReadingDocument(
    work,
    document,
    AbortSignal.timeout(10000),
  );
  clearTimeout(timer);
  assert.equal(responsive, true);
  assert.ok(result.entries![0].body.startsWith("Synthetic PDF text"));
  assert.equal(
    result.entries![0].body.replace(/\s+/g, " ").trim(),
    "Synthetic PDF text with a full original paragraph and enough readable source evidence. "
      .repeat(3)
      .trim(),
  );
  assert.equal(result.document!.body, document.body);
  assert.equal(result.document!.encoding, "base64");
  assert.equal(
    result.document!.sha256,
    createHash("sha256").update(bytes).digest("hex"),
  );
  assert.equal(result.document!.resolved_url, document.resolved_url);
  await assert.rejects(
    extractReadingFullText({
      ...document,
      body: readingPdfFixture("Readable text", 101).toString("base64"),
    }),
    { statusCode: 413 },
  );
  await assert.rejects(
    extractReadingFullText({
      ...document,
      body: Buffer.from("%PDF-invalid").toString("base64"),
    }),
  );
  await assert.rejects(
    extractReadingFullText({ ...document, body: document.body + " " }),
    { statusCode: 413 },
  );
});
test("main article extraction excludes navigation and executable markup, honours publisher restrictions and rejects challenge pages", async () => {
  const source =
    '<html><head><title>Selected article</title></head><body><nav>UNRELATED NAVIGATION <a href="/">Homepage</a></nav><article><h1>Selected article</h1><p>' +
    "An original paragraph with evidence, uncertainty, and a practical example. ".repeat(
      12,
    ) +
    '</p></article><script>globalThis.executed=true;fetch("https://evil.example")</script></body></html>';
  const result = await extractReadingFullText({
    body: source,
    content_type: "text/html",
  });
  assert.ok(result.includes("An original paragraph"));
  assert.ok(!result.includes("UNRELATED NAVIGATION"));
  assert.ok(!result.includes("globalThis.executed"));
  assert.equal((globalThis as any).executed, undefined);
  await assert.rejects(
    extractReadingFullText({
      body: source.replace(
        "</head>",
        '<script type="application/ld+json">{"@graph":[{"isAccessibleForFree":false}]}</script></head>',
      ),
      content_type: "text/html",
    }),
    { statusCode: 422 },
  );
  await assert.rejects(
    extractReadingFullText({
      body: "Checking your browser " + "challenge ".repeat(30),
      content_type: "text/plain",
    }),
    { statusCode: 422 },
  );
  await assert.rejects(
    extractReadingFullText({
      body: "Only a short teaser",
      content_type: "text/plain",
    }),
    { statusCode: 422 },
  );
  assert.equal(
    (
      await extractReadingFullText({
        body: "x".repeat(500000),
        content_type: "text/plain",
      })
    ).length,
    500000,
  );
  await assert.rejects(
    extractReadingFullText({
      body: "x".repeat(500001),
      content_type: "text/plain",
    }),
    { statusCode: 413 },
  );
});
test("reading HTTP/PDF and each redirect stay DNS-pinned, bounded and credential-free while learning retains its narrower permissions", async () => {
  let hits = 0,
    status = 302,
    host = "public.example",
    address = "93.184.216.34",
    body: Buffer = readingPdfFixture(),
    type = "application/pdf",
    location = "https://next.example/document.pdf";
  const io: any = {
    lookup: async () => [{ address, family: 4 }],
    request: (url: URL, options: any, onResponse: any) => {
      hits++;
      host = url.hostname;
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(options.headers.Cookie, undefined);
      options.lookup(url.hostname, { all: true }, (e: any, ips: any) =>
        assert.equal(ips[0].address, address),
      );
      const req: any = new EventEmitter();
      req.setTimeout = () => req;
      req.end = () =>
        queueMicrotask(() => {
          const r: any = new PassThrough();
          r.statusCode = status;
          r.headers = {
            "content-type": type,
            ...(status === 302 ? { location } : {}),
          };
          onResponse(r);
          if (!r.destroyed) r.end(body);
        });
      req.destroy = (e: any) => {
        req.emit("error", e);
        return req;
      };
      return req;
    },
  };
  const fetcher: typeof fetchPublicSourceBytes = async (
    url,
    signal,
    _io,
    limit,
    reading,
  ) => {
    if (hits) status = 200;
    return fetchPublicSourceBytes(url, signal, io, limit, reading);
  };
  const result = await fetchReadingSource(
    "http://public.example/start",
    AbortSignal.timeout(1000),
    fetcher,
  );
  assert.equal(hits, 2);
  assert.equal(host, "next.example");
  assert.equal(result.encoding, "base64");
  assert.equal(Buffer.from(result.body, "base64").equals(body), true);
  hits = 0;
  status = 302;
  location = "http://127.0.0.1/private";
  await assert.rejects(
    fetchReadingSource(
      "http://public.example/start",
      AbortSignal.timeout(1000),
      fetcher,
    ),
  );
  assert.equal(hits, 1);
  hits = 0;
  status = 302;
  location = "https://next.example/private";
  const rebound: typeof fetchPublicSourceBytes = async (
    url,
    signal,
    _io,
    limit,
    reading,
  ) => {
    if (hits) address = "127.0.0.1";
    return fetchPublicSourceBytes(url, signal, io, limit, reading);
  };
  await assert.rejects(
    fetchReadingSource(
      "https://public.example/start",
      AbortSignal.timeout(1000),
      rebound,
    ),
    /SOURCE_ADDRESS_FORBIDDEN/,
  );
  assert.equal(hits, 1);
  address = "93.184.216.34";
  status = 200;
  body = Buffer.alloc(8000001);
  await assert.rejects(
    fetchReadingSource(
      "https://public.example/start",
      AbortSignal.timeout(1000),
      (url, sig, _io, limit, reading) =>
        fetchPublicSourceBytes(url, sig, io, limit, reading),
    ),
    /SOURCE_TOO_LARGE/,
  );
  await assert.rejects(
    fetchLearningSource(
      "http://public.example/start",
      AbortSignal.timeout(1000),
      io,
    ),
    /SOURCE_URL_FORBIDDEN/,
  );
});
