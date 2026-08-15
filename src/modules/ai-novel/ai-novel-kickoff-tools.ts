import type { LLMToolDefinition } from "../../services/llm-manager.ts";

const kickoffToolWireNames = {
  readMeta: "read_meta",
  updateMeta: "update_meta",
  askQuestion: "ask_question",
  ready: "ready",
} as const;

const kickoffScalePresetCustom = "custom";
const kickoffScaleLengthPresets = new Set([
  "short",
  "medium",
  "long",
  "epic",
  kickoffScalePresetCustom,
]);
const kickoffChapterLengthPresets = new Set([
  "short",
  "standard",
  "long",
  "extra_long",
  kickoffScalePresetCustom,
]);
const kickoffPovPresets = new Set([
  "single_pov",
  "dual_pov",
  "ensemble_pov",
  kickoffScalePresetCustom,
]);
const kickoffThreadDensityPresets = new Set([
  "single_main_thread",
  "main_with_subthreads",
  "multi_thread",
  kickoffScalePresetCustom,
]);
const kickoffPacePresets = new Set([
  "fast",
  "moderate",
  "slow_burn",
  kickoffScalePresetCustom,
]);

function kickoffScaleChoiceSchema(
  presets: string[],
  description: string,
): Record<string, unknown> {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["preset", "note"],
    properties: {
      preset: {
        type: "string",
        enum: presets,
        description:
          "Canonical fixed English preset. Use custom only when no fixed preset fits; do not invent new preset strings.",
      },
      note: {
        type: "string",
        description:
          "Freeform explanation in the user's writing language. Required and meaningful when preset is custom; otherwise keep concise.",
      },
    },
  };
}

const kickoffChapterLengthSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Target length for one chapter body. This constrains draft generation; title/volume title are not counted.",
  additionalProperties: false,
  required: ["preset", "note"],
  properties: {
    preset: {
      type: "string",
      enum: [...kickoffChapterLengthPresets],
      description:
        "Canonical fixed English chapter-length preset. custom is a fixed value, not a free-text slot.",
    },
    minChars: {
      type: "number",
      description:
        "Lower bound for target chapter body length. Number only, no units.",
    },
    maxChars: {
      type: "number",
      description:
        "Upper bound for target chapter body length. Number only, no units.",
    },
    note: {
      type: "string",
      description:
        "Freeform explanation in the user's writing language. Required and meaningful when preset is custom; otherwise keep concise.",
    },
  },
};

const kickoffPremiseScaleSchema: Record<string, unknown> = {
  type: "object",
  description:
    "Real JSON object for book scale. Use fixed English presets plus note; never put free text directly in preset.",
  additionalProperties: false,
  required: ["length", "chapterLength", "pov", "threadDensity", "pace"],
  properties: {
    length: kickoffScaleChoiceSchema(
      [...kickoffScaleLengthPresets],
      "Overall book length scale.",
    ),
    chapterLength: kickoffChapterLengthSchema,
    pov: kickoffScaleChoiceSchema(
      [...kickoffPovPresets],
      "Narrative POV scale.",
    ),
    threadDensity: kickoffScaleChoiceSchema(
      [...kickoffThreadDensityPresets],
      "Main-thread/subthread density.",
    ),
    pace: kickoffScaleChoiceSchema([...kickoffPacePresets], "Story pacing."),
  },
};

const kickoffToolDefinitions: LLMToolDefinition[] = [
  {
    name: kickoffToolWireNames.readMeta,
    description:
      "Read the full current kickoff premise draft. Call with an empty object `{}` and no arguments.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
  },
  {
    name: kickoffToolWireNames.updateMeta,
    description:
      "Patch one or more fields in the current kickoff premise draft. Arrays must be real JSON arrays and objects must be real JSON objects, never strings containing JSON.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        titleCandidate: {
          type: "string",
          description:
            "Concrete candidate book title. Never use placeholders such as 待定书名, Untitled, or TBD.",
        },
        readiness: {
          type: "number",
          description: "Conservative readiness score from 0 to 1.",
        },
        storyPromise: {
          type: "string",
          description:
            "The durable reader-facing promise/core appeal of the book.",
        },
        storyAnchors: {
          type: "array",
          description:
            "Real JSON array of durable story anchors. Anchors can be a protagonist, protagonist group, central relationship, mystery, pressure source, or story stage. This is not a character database.",
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "role", "rules"],
            properties: {
              label: {
                type: "string",
                description:
                  "Concise anchor label in the user's writing language, e.g. protagonist, protagonist group, central relationship, core mystery, or main stage.",
              },
              name: {
                type: "string",
                description:
                  "Optional concrete character name when this anchor represents the protagonist or another named character. For protagonist anchors, this must be a real name, alias, or codename, never a pronoun such as 我/I or a generic label such as 主角.",
              },
              role: {
                type: "string",
                description:
                  "Free-text anchor role in the user's writing language. Do not use a fixed taxonomy; write the role naturally for this book.",
              },
              rules: {
                type: "array",
                description:
                  "Durable rules or constraints for this anchor; keep 1-5 concise items.",
                items: { type: "string" },
              },
            },
          },
        },
        focalization: {
          type: "string",
          description: "Narrative viewpoint/information limit.",
        },
        startState: {
          type: "string",
          description: "The protagonist/world state before the trigger.",
        },
        trigger: {
          type: "string",
          description: "The concrete event that starts the story movement.",
        },
        drive: {
          type: "object",
          description:
            "Real JSON object describing what the protagonist/story is trying to do.",
          additionalProperties: false,
          properties: {
            mode: {
              type: "string",
              description:
                "Free-text drive mode, for example discover, escape, protect, repair, survive, or a more specific phrase.",
            },
            object: {
              type: "string",
              description: "The concrete target or problem being pursued.",
            },
          },
        },
        pressureSources: {
          type: "array",
          description:
            "Real JSON array of external/relational/internal forces pressing on the story.",
          items: { type: "string" },
        },
        stakes: {
          type: "object",
          description:
            "Real JSON object describing what is at risk on external, relational, and internal layers.",
          additionalProperties: false,
          properties: {
            external: { type: "string", description: "External/world risk." },
            relational: {
              type: "string",
              description: "Relationship/social risk.",
            },
            internal: { type: "string", description: "Inner/moral risk." },
          },
        },
        worldConstraints: {
          type: "array",
          description:
            "Real JSON array of hard world/genre/rule constraints the engine must preserve.",
          items: { type: "string" },
        },
        changeHorizon: {
          type: "string",
          description: "The expected long-range transformation arc.",
        },
        premiseScale: {
          ...kickoffPremiseScaleSchema,
        },
        language: {
          type: "string",
          description: "Language used by the user in kickoff chat.",
        },
        toneRegister: {
          type: "string",
          description: "Tone/register/style constraints inferred from chat.",
        },
        extras: {
          type: "object",
          description:
            "Real JSON object for rare extra premise facts that do not fit canonical fields.",
        },
      },
    },
  },
  {
    name: kickoffToolWireNames.askQuestion,
    description:
      "Ask the user one focused kickoff question. Use this to gather preferences, clarify ambiguous premise details, or offer concrete directions. `options` must be a real JSON array of option objects with `label` and `subtitle`, never a string containing JSON.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["question", "options"],
      properties: {
        question: {
          type: "string",
          description: "Complete focused question to ask the user.",
        },
        options: {
          type: "array",
          description:
            "Available choices as a real JSON array. Do not pass a JSON-encoded string.",
          minItems: 2,
          maxItems: 4,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["label", "subtitle"],
            properties: {
              label: {
                type: "string",
                description: "Concise option display text.",
              },
              subtitle: {
                type: "string",
                description:
                  "Short user-facing explanation shown under this option.",
              },
            },
          },
        },
        allowCustom: {
          type: "boolean",
          description:
            "Allow typing a custom answer. Defaults to true when omitted; pass false only when custom input must be disabled.",
        },
      },
    },
  },
  {
    name: kickoffToolWireNames.ready,
    description:
      "Publish or republish the current complete kickoff proposal for user confirmation, with the ready-card summary and first MainLine plan. When the user currently intends to enter or re-enter the ready checkpoint and the proposal is complete, you must call ready in the current turn. This tool is the only way to display the ready card; a natural-language acknowledgement cannot replace it. ready is repeatable: a previous ready call does not block another ready call and does not satisfy the current request. Do not call it merely because a start-book phrase is quoted, discussed, or explicitly negated. Do not use ready while required canonical fields are missing; fill missing fields first. This tool pauses at confirmation and never drafts chapter prose.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["summary", "mainLine"],
      properties: {
        summary: {
          type: "string",
          description:
            "A concise natural-language description of what this book is like. This is shown on the ready card; it is not a contract field.",
        },
        mainLine: {
          type: "object",
          additionalProperties: false,
          required: [
            "revisionId",
            "title",
            "summary",
            "arcPromise",
            "arcRules",
            "startChapterIndex",
            "endChapterIndex",
            "beats",
          ],
          properties: {
            revisionId: {
              type: "string",
              description:
                "Use kickoff for the first ready plan. Later runtime may replace it with another revision.",
            },
            title: {
              type: "string",
              description:
                "User-facing title for the opening arc or first stage.",
            },
            summary: {
              type: "string",
              description:
                "User-facing 1-2 sentence summary of the first 6-10 chapters.",
            },
            arcPromise: {
              type: "string",
              description:
                "The user-facing reading promise for this opening arc or current stage.",
            },
            arcRules: {
              type: "array",
              items: { type: "string" },
              description:
                "Concrete current-stage rules derived from the Contract and user anti-trope constraints.",
            },
            startChapterIndex: { type: "integer", minimum: 1 },
            endChapterIndex: { type: "integer", minimum: 1 },
            beats: {
              type: "array",
              minItems: 6,
              maxItems: 10,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "id",
                  "chapterIndex",
                  "goal",
                  "mustCover",
                  "forbidden",
                  "change",
                  "endBoundary",
                  "endingOpenQuestion",
                ],
                properties: {
                  id: { type: "string" },
                  chapterIndex: { type: "integer", minimum: 1 },
                  goal: {
                    type: "string",
                    description:
                      "Concrete chapter-level movement, not a slogan.",
                  },
                  mustCover: {
                    type: "array",
                    items: { type: "string" },
                  },
                  forbidden: {
                    type: "array",
                    items: { type: "string" },
                  },
                  change: {
                    type: "string",
                    description:
                      "What irreversible story state changes in this chapter.",
                  },
                  endBoundary: {
                    type: "string",
                    description:
                      "Where this chapter must stop. It must tell the draft agent what later beat not to narrate yet.",
                  },
                  endingOpenQuestion: {
                    type: "string",
                    description:
                      "Concrete unresolved pressure or question, may be empty if not natural.",
                  },
                },
              },
            },
          },
        },
      },
    },
  },
];


export { kickoffToolDefinitions };
