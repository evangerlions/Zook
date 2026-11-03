const legacyEventTypes = new Set([
  "local_debug_llm_request", "reasoning_delta", "content_delta",
  "tool_call_delta", "tool_call", "usage", "done", "error",
]);

/** Missing or unrecognized versions use the published 1.5 stream contract. */
export function supportsModernAiStream(version: string | undefined): boolean {
  const match = version?.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:\+\d+)?$/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  return major > 1 || (major === 1 && minor >= 6);
}

export function supportsLegacyAiStreamEvent(event: unknown): boolean {
  return !!event && typeof event === "object" && !Array.isArray(event) &&
    legacyEventTypes.has((event as { type?: string }).type ?? "");
}
