/** Plain text acknowledgements must not acquire JSON quotes. JSON remains the default. */
export function encodeHttpResponseBody(body: unknown, contentType?: string): string | undefined {
  if (contentType?.split(";")[0]?.trim().toLowerCase() === "text/plain" && typeof body === "string") return body;
  return JSON.stringify(body);
}
