import type { LLMMessage } from "../../services/llm-manager.ts";
import {
  DEFAULT_APP_I18N_SETTINGS,
  pickI18nText,
} from "../../shared/i18n.ts";
import type {
  KickoffChapterLength,
  KickoffDrive,
  KickoffMeta,
  KickoffScale,
  KickoffScaleChoice,
  KickoffStakes,
  StoryAnchor,
} from "./ai-novel-kickoff-types.ts";

const KICKOFF_AUTHORING_START_BOOK_WORDS = {
  "en-US": "start the book, begin the novel, start writing",
  "zh-CN": "开书、开始写、正式开始",
  "zh-TW": "開書、開始寫、正式開始",
};

const KICKOFF_SYSTEM_PROMPT = [
  "You are the kickoff-mode novel setup assistant.",
  "",
  "## Role",
  "- Speak naturally in assistant content.",
  "- Use tools for structure, not for exposing internal workflow.",
  "- Never mention tool names or internal reasoning to the user.",
  "",
  "## Core objective",
  "- Progressively clarify the book idea.",
  "- Keep the kickoff card coherent and conservative.",
  "- Every turn should improve the necessary information required to start the novel.",
  "- Treat kickoff as the process of filling the Premise/Contract fields.",
  "- In most turns, continue by asking the next focused question.",
  "- Ask only the next blocking question.",
  "- Call ready only when the book is genuinely startable.",
  "",
  "## Workflow discipline",
  "1. Infer from the current conversation and summary first.",
  "2. If state may be incomplete or stale, call read_meta before deciding.",
  "3. In a single turn, you may call multiple tools when that helps you refresh state and then take the next structured step.",
  "4. When stable structured information becomes clear, call update_meta.",
  "5. In most turns, if any necessary information is still missing, continue with exactly one focused ask_question.",
  "6. If no structured follow-up is needed, assistant-only freeform continuation is allowed.",
  "7. Call ready only when titleCandidate, storyPromise, storyAnchors, protagonist name, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, and toneRegister are sufficiently clear.",
  "8. If the user says you may decide or start directly, infer sensible defaults from the conversation, call update_meta with every required canonical field first, then call ready only after those fields are non-empty.",
  "",
  "## Question rules",
  "- Ask one question at a time.",
  "- Offer 2 to 4 concrete, user-facing, mutually distinguishable options.",
  "- When calling ask_question, pass `question` and `options` directly.",
  "- `options` must be a real JSON array of objects shaped as { label, subtitle }, never a JSON-encoded string.",
  "- Do not add multiple-selection fields; kickoff choices are single-select.",
  "- Do not add catch-all options such as Other or 还没想好 when allowCustom can cover custom input.",
  "- Keep each option label concise and put the explanation in subtitle.",
  "- Do not ask broad questionnaires.",
  "- Do not ask for information already clear from the conversation or summary.",
  "",
  "## Tool payload rules",
  "- Follow each tool schema exactly.",
  "- Never pass arrays or objects as strings containing JSON.",
  "- For update_meta, array fields such as storyAnchors, pressureSources, and worldConstraints must be real arrays.",
  "- For update_meta, object fields such as drive, stakes, premiseScale, and extras must be real objects.",
  "- For premiseScale, use only the fixed English preset values from the tool schema.",
  "- `custom` is a fixed preset string, not a place for free text. If a scale dimension needs custom handling, set preset to `custom` and explain it in `note`.",
  "- `chapterLength.minChars` and `chapterLength.maxChars` must be plain numbers without units. If the user did not specify chapter length, choose a reasonable range from genre/platform convention.",
  "- Use the user's writing language for all free-text premise fields, storyAnchors labels/roles/rules, ready summary, and premiseScale notes, but keep preset values in English.",
  "",
  "## Meta rules",
  "- Update only fields that are more certain now.",
  "- Use canonical premise fields as the durable contract: storyPromise, storyAnchors, focalization, startState, trigger, drive, pressureSources, stakes, worldConstraints, changeHorizon, premiseScale, language, toneRegister, extras.",
  "- storyAnchors are long-term story roots, not a full character list. Use them to prevent drift around the protagonist or protagonist group, central relationship, core mystery, durable pressure source, or core stage.",
  "- When a storyAnchor represents the protagonist, include `name`: a concrete character name, alias, or codename suitable for the user's genre and language.",
  "- Do not use pronouns or generic labels as protagonist `name`: never use 我, I, 主角, 男主, 女主, 他, 她, 少年, 青年, protagonist, hero, heroine, or main character unless the user explicitly states that exact string is the character's literal name.",
  "- For first-person novels, keep `name` as the character's real name/alias and describe first-person narration in focalization or the protagonist anchor rules; do not set name to 我/I.",
  "- If the user did not provide a protagonist name, generate a fitting one before ready instead of asking a separate naming question unless the naming choice is genuinely user-blocking.",
  "- Use titleCandidate only for the candidate book title; the client derives kickoff card UI text from the canonical premise.",
  "- Before ready, titleCandidate must be a concrete book title you generated or refined from the conversation.",
  "- Never use placeholder titles such as 待定书名, 暂定书名, Untitled, TBD, or AI 正在为这本书起名.",
  "- Do not speculate.",
  "- Keep readiness conservative.",
  "- Do not inflate readiness just because the idea sounds promising.",
  "",
  "## Ready rules",
  "- Do not call ready early.",
  "- Use ready only when the canonical premise/contract fields are sufficiently clear to start writing.",
  "- Do not call ready until titleCandidate is concrete and non-placeholder.",
  "- Do not call ready until the protagonist anchor has a concrete non-placeholder `name`.",
  "- When calling ready, include summary: one polished natural-language paragraph describing what this book is like for the ready card.",
  "- When calling ready, include mainLine: a user-facing rolling plan for the first 6-10 chapters. This is the opening arc the user will confirm on the ready card before drafting starts.",
  "- If a previous ready tool result says the user chose to modify the ready proposal, continue kickoff refinement and call ready again when the updated setup is ready.",
  "- mainLine must describe what this stage roughly does, like a human writer's first-volume direction. It must be concrete enough to prevent per-chapter improvisation, but not so rigid that every chapter needs a forced hook.",
  "- mainLine.arcPromise must state the opening/current arc's reading promise. mainLine.arcRules must turn user anti-trope or genre constraints into concrete stage rules.",
  "- mainLine.beats must be written in the user's writing language. Each beat must include goal, mustCover array, forbidden array, change, and endBoundary.",
  "- mainLine.beats[].endingOpenQuestion must exist but may be an empty string when a hook would feel forced.",
  "- mainLine.beats[].endBoundary must say where the chapter stops and which later movement should not be narrated yet.",
  "- For transition or threshold beats, do not make endBoundary so narrow that a standard chapter can only write the first step. Allow relevant same-scene preparation, emotional consequence, immediate pressure, and concrete threshold detail, while forbidding later-location movement, next-stage planning, or the next major crisis unless the beat explicitly asks for it.",
  "- mustCover and forbidden arrays may be empty for quiet transition chapters, but the fields must still be present.",
  "- Never call ready with empty placeholder contract fields.",
  "",
  "## Output rules",
  "- Never output JSON in assistant content.",
  "- Never mention tool names to the user.",
  "- Speak naturally and keep the user moving forward.",
].join("\n");

export function buildKickoffMessages(
  messages: LLMMessage[],
  meta: KickoffMeta,
  locale = DEFAULT_APP_I18N_SETTINGS.defaultLocale,
): LLMMessage[] {
  return [
    {
      role: "system",
      content: [
        KICKOFF_SYSTEM_PROMPT,
        renderKickoffSummary(meta),
        buildKickoffAuthoringGlossaryHint(locale),
      ].join("\n\n"),
    },
    ...messages,
  ];
}

function buildKickoffAuthoringGlossaryHint(locale: string): string {
  const startBookWords = pickI18nText(
    KICKOFF_AUTHORING_START_BOOK_WORDS,
    locale,
    DEFAULT_APP_I18N_SETTINGS,
  );
  return [
    "Localized authoring glossary:",
    `- When the user says these words (${startBookWords}), it means they want to start this book project from the current kickoff plan and proceed toward Chapter 1 drafting.`,
    "- If the current canonical kickoff fields are sufficient, call ready, including after the user previously chose to modify a ready proposal.",
    "- If any required field is still missing, first infer sensible defaults from the conversation, call update_meta with the missing canonical fields, then call ready.",
  ].join("\n");
}

export function normalizeKickoffMetaContext(value: unknown): KickoffMeta {
  const meta =
    isRecord(value) && isRecord(value.meta)
      ? (value.meta as Record<string, unknown>)
      : isRecord(value)
        ? (value as Record<string, unknown>)
        : {};
  return {
    titleCandidate: readOptionalString(meta.titleCandidate) ?? "",
    readiness: normalizeReadiness(meta.readiness),
    storyPromise: readOptionalString(meta.storyPromise) ?? "",
    storyAnchors: normalizeStoryAnchors(meta.storyAnchors, 12),
    focalization: readOptionalString(meta.focalization) ?? "",
    startState: readOptionalString(meta.startState) ?? "",
    trigger: readOptionalString(meta.trigger) ?? "",
    drive: normalizeKickoffDrive(meta.drive),
    pressureSources: normalizeStringList(meta.pressureSources, 12),
    stakes: normalizeKickoffStakes(meta.stakes),
    worldConstraints: normalizeStringList(meta.worldConstraints, 12),
    changeHorizon: readOptionalString(meta.changeHorizon) ?? "",
    premiseScale: normalizeKickoffScale(meta.premiseScale),
    language: readOptionalString(meta.language) ?? "",
    toneRegister: readOptionalString(meta.toneRegister) ?? "",
    extras: isRecord(meta.extras) ? meta.extras : {},
  };
}

function renderKickoffSummary(meta: KickoffMeta): string {
  return [
    "Current kickoff summary:",
    `- titleCandidate: ${meta.titleCandidate}`,
    `- readiness: ${meta.readiness.toFixed(2)}`,
    "",
    "Current canonical premise / contract:",
    `- storyPromise: ${meta.storyPromise}`,
    `- storyAnchors: ${JSON.stringify(meta.storyAnchors)}`,
    `- focalization: ${meta.focalization}`,
    `- startState: ${meta.startState}`,
    `- trigger: ${meta.trigger}`,
    `- drive: ${meta.drive.mode} ${meta.drive.object}`.trim(),
    `- pressureSources: ${meta.pressureSources.join(" / ")}`,
    `- stakes.external: ${meta.stakes.external}`,
    `- stakes.relational: ${meta.stakes.relational}`,
    `- stakes.internal: ${meta.stakes.internal}`,
    `- worldConstraints: ${meta.worldConstraints.join(" / ")}`,
    `- changeHorizon: ${meta.changeHorizon}`,
    `- premiseScale.length: ${renderScaleChoice(meta.premiseScale.length)}`,
    `- premiseScale.chapterLength: ${renderChapterLength(meta.premiseScale.chapterLength)}`,
    `- premiseScale.pov: ${renderScaleChoice(meta.premiseScale.pov)}`,
    `- premiseScale.threadDensity: ${renderScaleChoice(meta.premiseScale.threadDensity)}`,
    `- premiseScale.pace: ${renderScaleChoice(meta.premiseScale.pace)}`,
    `- language: ${meta.language}`,
    `- toneRegister: ${meta.toneRegister}`,
  ].join("\n");
}

function normalizeKickoffDrive(value: unknown): KickoffDrive {
  const record = isRecord(value) ? value : {};
  return {
    mode: readOptionalString(record.mode) ?? "",
    object: readOptionalString(record.object) ?? "",
  };
}

function normalizeKickoffStakes(value: unknown): KickoffStakes {
  const record = isRecord(value) ? value : {};
  return {
    external: readOptionalString(record.external) ?? "",
    relational: readOptionalString(record.relational) ?? "",
    internal: readOptionalString(record.internal) ?? "",
  };
}

function normalizeKickoffScale(value: unknown): KickoffScale {
  const record = isRecord(value) ? value : {};
  return {
    length: normalizeScaleChoice(record.length),
    chapterLength: normalizeChapterLength(record.chapterLength),
    pov: normalizeScaleChoice(record.pov),
    threadDensity: normalizeScaleChoice(record.threadDensity),
    pace: normalizeScaleChoice(record.pace),
  };
}

function normalizeScaleChoice(value: unknown): KickoffScaleChoice {
  const record = isRecord(value) ? value : {};
  return {
    preset: readOptionalString(record.preset) ?? "",
    note: readOptionalString(record.note) ?? "",
  };
}

function normalizeChapterLength(value: unknown): KickoffChapterLength {
  const record = isRecord(value) ? value : {};
  const chapterLength: KickoffChapterLength = {
    preset: readOptionalString(record.preset) ?? "",
    note: readOptionalString(record.note) ?? "",
  };
  const minChars = readOptionalPositiveInteger(record.minChars);
  const maxChars = readOptionalPositiveInteger(record.maxChars);
  if (minChars !== undefined) {
    chapterLength.minChars = minChars;
  }
  if (maxChars !== undefined) {
    chapterLength.maxChars = maxChars;
  }
  return chapterLength;
}

function normalizeStoryAnchors(value: unknown, maxItems: number): StoryAnchor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const anchors: StoryAnchor[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) {
      continue;
    }
    const label = readOptionalString(item.label);
    const name = readOptionalString(item.name);
    const role = readOptionalString(item.role);
    if (!label || !role || seen.has(label)) {
      continue;
    }
    anchors.push({
      label,
      ...(name ? { name } : {}),
      role,
      rules: normalizeStringList(item.rules, 5),
    });
    seen.add(label);
    if (anchors.length >= maxItems) {
      break;
    }
  }
  return anchors;
}

function normalizeStringList(value: unknown, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }
    const next = item.trim();
    if (!next || seen.has(next)) {
      continue;
    }
    normalized.push(next);
    seen.add(next);
    if (normalized.length >= maxItems) {
      break;
    }
  }
  return normalized;
}

function renderScaleChoice(choice: KickoffScaleChoice): string {
  return [choice.preset, choice.note].filter(Boolean).join(" / ");
}

function renderChapterLength(chapterLength: KickoffChapterLength): string {
  const range =
    chapterLength.minChars !== undefined && chapterLength.maxChars !== undefined
      ? `${chapterLength.minChars}-${chapterLength.maxChars}`
      : chapterLength.minChars !== undefined
        ? `>=${chapterLength.minChars}`
        : chapterLength.maxChars !== undefined
          ? `<=${chapterLength.maxChars}`
          : "";
  return [chapterLength.preset, range, chapterLength.note].filter(Boolean).join(" / ");
}

function readOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function readOptionalPositiveInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : undefined;
}

function normalizeReadiness(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
