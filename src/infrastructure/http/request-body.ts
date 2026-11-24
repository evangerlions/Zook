function getContentType(contentTypeHeader?: string): string {
  return contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function shouldParseAsJson(contentTypeHeader?: string): boolean {
  const contentType = getContentType(contentTypeHeader);
  return contentType === "application/json" || contentType.endsWith("+json");
}

export class RequestBodyTooLargeError extends Error {}

export async function bufferRequestBody(
  request: AsyncIterable<Buffer>,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new RequestBodyTooLargeError("Request body exceeds allowed size");
    chunks.push(chunk);
  }

  return Buffer.concat(chunks, size);
}

export async function readRequestBody(
  request: AsyncIterable<Buffer>,
  contentTypeHeader?: string,
  maxBytes?: number,
): Promise<unknown> {
  const body = await bufferRequestBody(request, maxBytes);
  if (body.length === 0) return undefined;
  if (!shouldParseAsJson(contentTypeHeader)) {
    return body;
  }

  const text = body.toString("utf8");
  return text ? JSON.parse(text) : undefined;
}
