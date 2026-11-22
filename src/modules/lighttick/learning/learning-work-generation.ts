import { courseGenerationContext } from "./learning-generation-context.ts";
import type { LLMCompletionRequest, LLMCompletionResult } from "../../../services/llm-manager-types.ts";
import { LIGHTTICK_PROMPT_VERSION, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-prompts.ts";
import { LIGHTTICK_AI_SCENES } from "../ai/lighttick-ai-scenes.ts";
import { parseLightTickJson } from "../ai/lighttick-ai-validation.ts";
import { courseBrief, courseDocument } from "./learning-route.validation.ts";
import type { LearningSource, LearningWork, LearningWorkKind } from "./learning-work.types.ts";
import { canonical, text, keys, fail } from "./native-learning.validation.ts";
import { REPORT_PROMPT, reportQuoteOptions, reportQuoteSchema, resolveReportQuotes, validateReportFeedback } from "./work-report-practice.ts";

function parseLearningOutput(output: string, isLesson: boolean): Record<string, unknown> {
  try {
    return parseLightTickJson(output);
  } catch {
    // Some models close the content member early. Accept only the two exact JSON string fields.
    const misplacedBrace = isLesson && /^\s*\{\s*"content"\s*:\s*("(?:[^"\\]|\\[\s\S])*")\s*\}\s*,\s*"references"\s*:\s*("(?:[^"\\]|\\[\s\S])*")\s*\}\s*$/.exec(output);
    if (misplacedBrace) return parseLightTickJson(`{"content":${misplacedBrace[1]},"references":${misplacedBrace[2]}}`);
    const lines = isLesson ? output.trim().split(/\r?\n/) : [];
    if (lines.length === 2) {
      try {
        const [body, sources] = lines.map(parseLightTickJson);
        if (Object.keys(body).length === 1 && typeof body.content === 'string' && typeof sources.references === 'string' &&
          (Object.keys(sources).length === 1 || (Object.keys(sources).length === 2 && sources.content === body.content))) {
          return { content: body.content, references: sources.references };
        }
      } catch {
        fail(422, 'The model returned invalid learning JSON.');
      }
    }
    fail(422, 'The model returned invalid learning JSON.');
  }
}

function separateExerciseAndAnalysis(content: string): string {
  const headings = [...content.matchAll(/^ {0,3}#{1,6}[ \t]+(?:[一二三四五六七八九十\d]+[、.．)）][ \t]*)?(练习|参考分析)(?=$|[ \t：:（(])/gm)];
  const exerciseHeading = headings.find(heading => heading[1] === '练习');
  const analysisHeading = headings.find(heading => heading[1] === '参考分析');
  const exercise = exerciseHeading?.index ?? content.indexOf('练习');
  const analysis = analysisHeading?.index ?? content.indexOf('参考分析');
  if (analysis > exercise && /\n---[ \t]*\r?\n/.test(content.slice(exercise, analysis))) return content;
  if (analysis > exercise && exerciseHeading && analysisHeading && headings.length === 2) {
    const separated = content.slice(0, analysis).trimEnd() + '\n\n---\n\n' + content.slice(analysis);
    return text(separated, 100000, true);
  }
  fail(422, 'Separate exercise and reference analysis before publication.');
}

export function learningGenerationScene(kind: LearningWorkKind) {
  switch (kind) {
    case "report_review": return "learning_practice_review";
    case "route_draft": return "learning_route";
    case "lesson_draft": return "learning_lesson";
    default: throw new Error("Work has no model generation stage.");
  }
}

export const LESSON_OUTPUT_SCHEMA = {
  type: "object", additionalProperties: false, required: ["content", "references"],
  properties: { content: { type: "string", maxLength: 100000 }, references: { type: "string", maxLength: 100000 } },
};

export function prepareLearningGeneration(
  work: LearningWork,
  sources: LearningSource[],
  scene: { modelAlias: string; maxContextTokens: number; maxOutputTokens: number; timeoutMs: number },
) {
  const review = work.kind === "report_review";
  const sceneName = learningGenerationScene(work.kind);
  const hard = LIGHTTICK_AI_SCENES[sceneName];
  const quotes = review ? reportQuoteOptions(work.input.submission) : [];
  const input: Record<string, unknown> = review
    ? { submission_segments: quotes, rubric: work.input.rubric }
    : { ...work.input, sources };
  delete input.collected_sources;
  delete input.model_selection;
  const course = work.kind === "route_draft" ? courseGenerationContext(courseBrief(work.input.brief)) : undefined;
  const schema = review ? reportQuoteSchema(quotes) : course?.schema ?? LESSON_OUTPUT_SCHEMA;
  const instruction = review ? REPORT_PROMPT : LIGHTTICK_SCENE_PROMPTS[sceneName];
  const schedule = course ? `COURSE_CONSTRAINTS=${JSON.stringify(course.constraints)}\n` : "";
  const user = `${instruction}\n${schedule}OUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\nINPUT_JSON=${JSON.stringify(input)}`;
  if (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + user) > Math.min(scene.maxContextTokens, hard.maxContextTokens)) {
    fail(422, "Reviewed source context exceeds learning scene capacity.");
  }
  const messages: LLMCompletionRequest["messages"] = [
    { role: "system", content: LIGHTTICK_SYSTEM_PROMPT },
    { role: "user", content: user },
  ];
  return {
    work, sources, quotes, schema, sceneKey: hard.key,
    request: { modelKey: scene.modelAlias, messages, maxTokens: Math.min(scene.maxOutputTokens, hard.maxOutputTokens), temperature: 0.2 },
    timeoutMs: Math.min(scene.timeoutMs, hard.timeoutMs),
  };
}

export function validateLearningGeneration(
  prepared: Pick<ReturnType<typeof prepareLearningGeneration>, "work" | "sources" | "quotes" | "sceneKey">,
  result: Pick<LLMCompletionResult, "text" | "finishReason" | "provider" | "providerModel">,
): Record<string, unknown> {
  const { work, sources, quotes } = prepared;
  const review = work.kind === "report_review";
  const raw = parseLearningOutput(result.text, work.kind === "lesson_draft");
  let draft: Record<string, unknown>;

  if (work.kind === "route_draft") {
    const brief = courseBrief(work.input.brief);
    const document = courseDocument(raw, brief);
    for (const old of work.input.frozen ?? []) {
      if (canonical(old) !== canonical(document.lessons[old.number - 1])) fail(422, "AI draft changed an already published lesson blueprint.");
    }
    draft = { brief, document };
  } else if (review) {
    draft = validateReportFeedback(resolveReportQuotes(raw, quotes), work.input.submission);
  } else {
    keys(raw, ["content", "references"]);
    const content = text(raw.content, 100000, true);
    const references = text(raw.references, 100000, true);
    for (const section of ["引导问题", "概念", "示范", "边界", "练习", "参考分析", "自查", "记忆提示"]) {
      if (!content.includes(section)) fail(422, "Lesson teaching sections are incomplete.");
    }
    const separatedContent = separateExerciseAndAnalysis(content);
    const urlPattern = /https?:\/\/[^\s<>\)\]"，。；]+/g;
    const allowed = new Set<string>();
    for (const source of sources) {
      if (source.source.url) allowed.add(source.source.url);
      for (const match of source.content.matchAll(urlPattern)) allowed.add(match[0]);
    }
    for (const match of (content + "\n" + references).matchAll(urlPattern)) {
      if (!allowed.has(match[0])) fail(422, "Lesson references must come from reviewed source material.");
    }
    draft = { content: separatedContent, references, source_digests: sources.map(source => source.digest) };
  }
  return { ...draft, prompt_version: LIGHTTICK_PROMPT_VERSION, scene_key: prepared.sceneKey, provider: result.provider, model: result.providerModel };
}
