function getContentType(contentTypeHeader?: string): string {
  return contentTypeHeader?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function shouldParseAsJson(contentTypeHeader?: string): boolean {
  const contentType = getContentType(contentTypeHeader);
  return contentType === "application/json" || contentType.endsWith("+json");
}

export async function readRequestBody(
  request: AsyncIterable<Buffer>,
  contentTypeHeader?: string,
  maxBytes = Number.POSITIVE_INFINITY,
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new Error("Request body exceeds allowed size");
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const body = Buffer.concat(chunks);
  if (!shouldParseAsJson(contentTypeHeader)) {
    return body;
  }

  const text = body.toString("utf8");
  return text ? JSON.parse(text) : undefined;
}
