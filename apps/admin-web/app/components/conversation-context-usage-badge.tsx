import type { AiNovelTraceContextUsage } from "../lib/types";

export function ConversationContextUsageBadge({
  usage,
}: {
  usage?: AiNovelTraceContextUsage;
}) {
  if (!usage || usage.contextWindowTokens <= 0) return null;
  const remainingTokens = Math.max(
    0,
    usage.contextWindowTokens - usage.occupiedTokens,
  );
  const remainingPercent = Math.min(
    100,
    Math.max(0, Math.round((remainingTokens / usage.contextWindowTokens) * 100)),
  );
  const title = [
    `Context remaining: ${remainingTokens.toLocaleString()} / ${usage.contextWindowTokens.toLocaleString()} tokens`,
    usage.source === "provider" ? "provider fallback" : "Pi estimate",
  ].join(" · ");
  return (
    <span
      aria-label={title}
      className={`conversation-context-usage-badge is-${usage.source}`}
      title={title}
    >
      {remainingPercent}% left
    </span>
  );
}
