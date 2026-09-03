import type { LlmRoutingIdentity } from "../../services/llm-manager.ts";
import { getHeader } from "../../shared/utils.ts";

export function resolveAiNovelRoutingIdentity(
  headers: Record<string, string | undefined>,
  userId: string,
): LlmRoutingIdentity {
  return {
    did: getHeader(headers, "x-did"),
    uid: userId,
  };
}
