import { text } from "./planning-context.ts";
import { MAX_PLANNING_QUESTIONS } from "./planning-personal-context.ts";

function questionSentences(message: string): string[] {
  return message.split(/(?<=[?？。！!；;])|\r?\n/u).flatMap(sentence => {
    const item = sentence.trim();
    const listMarker = /^(?:[-*+•]\s+|[\d一二三四五六七八九十]{1,3}[.)、]\s*)/u;
    const value = item.replace(listMarker, "");
    const looksLikeQuestion = listMarker.test(item) || /[?？]/u.test(value) ||
      /^(?:请(?:补充|告诉|确认|提供|描述|说明)|你(?:想要什么|希望什么|是否|有多少|什么时候|目前有)|是否|能否|可否|how\b|what\b|when\b|where\b|which\b|who\b|could you\b|would you\b|do you\b)/iu.test(value);
    return value && looksLikeQuestion ? [value] : [];
  });
}

function questionKey(value: string) {
  return value.normalize("NFKC").toLowerCase().replace(/[\p{P}\s]+/gu, "");
}

export function checkedClarification(output: Record<string, unknown>) {
  const message = text(output.message);
  const legacyQuestions = questionSentences(message);
  if (legacyQuestions.length > MAX_PLANNING_QUESTIONS) throw Error("Too many clarification questions.");
  const structured = output.questions;
  if (structured !== undefined && (!Array.isArray(structured) || structured.length > MAX_PLANNING_QUESTIONS))
    throw Error("Invalid clarification questions.");
  const questions = new Map(legacyQuestions.map(question => [questionKey(question), question]));
  const added: string[] = [];
  for (const raw of structured ?? []) {
    const question = text(raw, 300);
    if (/[\r\n]/u.test(question) || questionSentences(question).length > 1)
      throw Error("A clarification item must ask one question.");
    const key = questionKey(question);
    if (!key) throw Error("A clarification question must contain text.");
    if (questions.has(key)) continue;
    questions.set(key, question);
    added.push(question);
  }
  if (questions.size > MAX_PLANNING_QUESTIONS) throw Error("Too many clarification questions.");
  return { message: text([message, ...added].join("\n")), questions: [...questions.values()] };
}
