import { readingSourceFailure } from "./reading-failure.ts";
import { fileURLToPath } from "node:url";
import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import { visibleHtmlText } from "../../../shared/visible-html-text.ts";
import { fail } from "../learning/native-learning.validation.ts";
import type { ReadingDocument } from "./reading-collection.ts";
export const READING_SOURCE_BYTES = 8_000_000,
  READING_FULL_CHARACTERS = 500_000;
export function readingDocumentBytes(document: ReadingDocument): Buffer {
  if (document.encoding !== undefined && document.encoding !== "base64")
    fail(422, "来源编码无法核对。");
  if (document.encoding === "base64") {
    if (
      document.body.length > Math.ceil(READING_SOURCE_BYTES / 3) * 4 ||
      /[^A-Za-z0-9+/=]/.test(document.body)
    )
      fail(413, "PDF原始数据无法核对或超过容量。");
    const raw = Buffer.from(document.body, "base64");
    if (raw.toString("base64") !== document.body)
      fail(422, "PDF原始数据编码无效。");
    return raw;
  }
  return Buffer.from(document.body, "utf8");
}
function readable(value: string, minimum: number) {
  const text = value.trim(),
    prefix = text.slice(0, 300).toLowerCase();
  if (text.length > READING_FULL_CHARACTERS)
    readingSourceFailure("READING_TEXT_LIMIT", 413);
  if (
    text.length < minimum ||
    text.includes("\0") ||
    [
      "%pdf-",
      "just a moment",
      "access denied",
      "verify you are human",
      "checking your browser",
    ].some((s) => prefix.includes(s))
  )
    readingSourceFailure("READING_SOURCE_UNREADABLE");
  return text;
}
function paywall(document: ReturnType<typeof parseHTML>["document"]) {
  for (const script of document.querySelectorAll(
    'script[type="application/ld+json"]',
  )) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script.textContent ?? "");
    } catch {
      continue;
    }
    const stack = [parsed];
    let scanned = 0;
    while (stack.length) {
      if (++scanned > 40000) fail(413, "出版来源元数据超过容量。");
      const value = stack.pop();
      if (!value || typeof value !== "object") continue;
      if (
        !Array.isArray(value) &&
        [false, "false"].includes(
          (value as Record<string, any>).isAccessibleForFree,
        )
      )
        readingSourceFailure("READING_SOURCE_RESTRICTED");
      stack.push(...Object.values(value));
    }
  }
}
export async function extractReadingFullText(
  document: ReadingDocument,
  minimum = 100,
): Promise<string> {
  const raw = readingDocumentBytes(document);
  if (raw.length > READING_SOURCE_BYTES)
    readingSourceFailure("READING_SOURCE_SIZE", 413);
  if (document.encoding === "base64") {
    if (
      document.content_type !== "application/pdf" ||
      !raw.subarray(0, 5).equals(Buffer.from("%PDF-"))
    )
      fail(422, "PDF文件格式无法核对。");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const assets = new URL(".", import.meta.resolve("pdfjs-dist/package.json"));
    const loading = getDocument({
      data: new Uint8Array(raw),
      cMapUrl: fileURLToPath(new URL("cmaps/", assets)),
      standardFontDataUrl: fileURLToPath(new URL("standard_fonts/", assets)),
      useWorkerFetch: false,
      useSystemFonts: false,
      disableFontFace: true,
      enableXfa: false,
      useWasm: false,
      isOffscreenCanvasSupported: false,
      isImageDecoderSupported: false,
      stopAtErrors: true,
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true,
      maxImageSize: 0,
      verbosity: 0,
    });
    try {
      const pdf = await loading.promise;
      if (pdf.numPages > 100)
        readingSourceFailure("READING_PDF_PAGE_LIMIT", 413);
      if ((await pdf.getPermissions()) !== null)
        readingSourceFailure("READING_PDF_RESTRICTED");
      const pages: string[] = [];
      let length = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i),
          content = await page.getTextContent();
        let line = "",
          lastY: number | null = null;
        for (const item of content.items) {
          if (!("str" in item)) continue;
          const y = item.transform[5];
          if (lastY !== null && Math.abs(lastY - y) > 2) line += "\n";
          line += item.str + (item.hasEOL ? "\n" : " ");
          lastY = y;
        }
        const text = line.trim();
        length += text.length + (pages.length ? 2 : 0);
        if (length > READING_FULL_CHARACTERS)
          readingSourceFailure("READING_TEXT_LIMIT", 413);
        pages.push(text);
        page.cleanup();
      }
      return readable(pages.join("\n\n"), 100);
    } catch (error: any) {
      if (error?.name === "PasswordException")
        readingSourceFailure("READING_PDF_ENCRYPTED");
      throw error;
    } finally {
      await loading.destroy();
    }
  }
  if (/^text\/(?:plain|markdown)(?:;|$)/.test(document.content_type))
    return readable(document.body, minimum);
  if (
    !/^(?:text\/html|application\/xhtml\+xml)(?:;|$)/.test(
      document.content_type,
    )
  )
    fail(422, "此来源不是支持的全文格式。");
  if ((document.body.match(/</g)?.length ?? 0) > 40000)
    fail(413, "页面标记超过容量。");
  const { document: dom } = parseHTML(
    /<html(?:\s|>)/i.test(document.body)
      ? document.body
      : "<!doctype html><html><head></head><body>" +
          document.body +
          "</body></html>",
  );
  paywall(dom);
  const article = new Readability(dom as unknown as Document, {
    maxElemsToParse: 40000,
    charThreshold: Math.min(500, minimum),
    disableJSONLD: true,
  }).parse();
  if (!article?.content) fail(422, "未能识别可读正文，请核对来源。");
  return readable(
    visibleHtmlText(article.content, READING_FULL_CHARACTERS),
    minimum,
  );
}
