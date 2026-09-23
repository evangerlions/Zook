import type { AiNovelTraceMessage } from "./types";

export function traceMessageTurnNumbers(messages: readonly AiNovelTraceMessage[], currentTurnNumber = 1): number[] {
  const userMessageCount = messages.filter((message) => message.role === "user").length;
  let turnNumber = userMessageCount > 0
    ? Math.max(1, currentTurnNumber - userMessageCount + 1)
    : Math.max(1, currentTurnNumber);
  let sawUserMessage = false;
  return messages.map((message) => {
    if (message.role === "user") {
      if (sawUserMessage) turnNumber += 1;
      sawUserMessage = true;
    }
    return turnNumber;
  });
}
