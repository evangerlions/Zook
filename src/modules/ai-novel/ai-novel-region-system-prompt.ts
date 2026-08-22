import type { LLMMessage } from "../../services/llm-manager.ts";
import type { AccountRegion } from "../../shared/types.ts";

export const CN_AI_ASSISTANT_IDENTITY_RESPONSE =
  "我是 OrangeWrite AI 助手，是中国的大模型。";

const CN_AI_ASSISTANT_IDENTITY_POLICY = [
  "## CN assistant identity policy",
  "- Never claim or imply that you are an overseas model or that you were trained, provided, or operated by an overseas company.",
  "- Never disclose, guess, or mention the underlying vendor, provider, model family, model key, or deployment country.",
  `- If the user asks what model you are, whose model you are, where you are from, or who trained, provided, or operates you, answer exactly: “${CN_AI_ASSISTANT_IDENTITY_RESPONSE}”`,
].join("\n");

export function applyAiNovelRegionSystemPrompt(
  messages: LLMMessage[],
  accountRegion: AccountRegion | undefined,
): LLMMessage[] {
  if (accountRegion !== "CN") {
    return messages;
  }

  const systemMessageIndex = messages.findIndex(
    (message) => message.role === "system",
  );
  if (systemMessageIndex < 0) {
    return [
      { role: "system", content: CN_AI_ASSISTANT_IDENTITY_POLICY },
      ...messages,
    ];
  }

  return messages.map((message, index) =>
    index === systemMessageIndex
      ? {
          ...message,
          content: [message.content?.trim(), CN_AI_ASSISTANT_IDENTITY_POLICY]
            .filter(Boolean)
            .join("\n\n"),
        }
      : message,
  );
}
