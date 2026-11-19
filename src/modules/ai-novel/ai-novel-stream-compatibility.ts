import { isAiNovelClientVersionAtLeast } from "./ai-novel-client-version.ts";

const legacyEventTypes = new Set([
  "local_debug_llm_request", "reasoning_delta", "content_delta",
  "tool_call_delta", "tool_call", "usage", "done", "error",
]);

/** Missing or unrecognized versions use the published 1.5 stream contract. */
export function supportsModernAiStream(version: string | undefined): boolean {
  return isAiNovelClientVersionAtLeast(version, "1.6.0");
}

export function supportsLegacyAiStreamEvent(event: unknown): boolean {
  return !!event && typeof event === "object" && !Array.isArray(event) &&
    legacyEventTypes.has((event as { type?: string }).type ?? "");
}
