export const READING_SOURCE_FAILURES = {
  READING_SOURCE_SIZE: "原始文件超过8MB，未截断保存。",
  READING_TEXT_LIMIT: "正文超过500000字符，未截断保存。",
  READING_SOURCE_UNREADABLE:
    "未取得可读正文，可能是摘要、验证页或无法提取的内容。",
  READING_SOURCE_RESTRICTED: "出版来源标明内容受访问限制，未保存摘要为全文。",
  READING_PDF_ENCRYPTED: "PDF已加密或要求密码，未提取正文。",
  READING_PDF_RESTRICTED: "PDF限制内容提取，未保存正文。",
  READING_PDF_PAGE_LIMIT: "PDF超过100页，未截断提取。",
} as const;
export type ReadingSourceFailure = keyof typeof READING_SOURCE_FAILURES;
export function readingFailureCode(error: any): ReadingSourceFailure | null {
  return typeof error?.code === "string" &&
    Object.hasOwn(READING_SOURCE_FAILURES, error.code)
    ? (error.code as ReadingSourceFailure)
    : null;
}
export function readingSourceFailure(
  code: ReadingSourceFailure,
  status = 422,
): never {
  throw Object.assign(new Error(READING_SOURCE_FAILURES[code]), {statusCode:status, code});
}
