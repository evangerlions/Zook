
function scaleChoiceSchema(presets: string[], description: string): Record<string, unknown> {
  return {
    type: "object",
    description,
    additionalProperties: false,
    required: ["preset", "note"],
    properties: {
      preset: {
        type: "string",
        enum: [...presets, "custom"],
        description: "Fixed English preset. Use custom only when no fixed preset fits; explain custom in note.",
      },
      note: {
        type: "string",
        description: "Freeform note in the user's writing language; required and meaningful when preset is custom.",
      },
    },
  };
}

const chapterLengthSchema: Record<string, unknown> = {
  type: "object",
  description: "Target length for one chapter body.",
  additionalProperties: false,
  required: ["preset", "note"],
  properties: {
    preset: {
      type: "string",
      enum: ["short", "standard", "long", "extra_long", "custom"],
    },
    minChars: {
      type: "number",
      description: "Lower target body length. Number only, no units.",
    },
    maxChars: {
      type: "number",
      description: "Upper target body length. Number only, no units.",
    },
    note: {
      type: "string",
      description: "Freeform note in the user's writing language; required and meaningful when preset is custom.",
    },
  },
};

export const bookScaleSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["length", "chapterLength", "pov", "threadDensity", "pace"],
  properties: {
    length: scaleChoiceSchema(["short", "medium", "long", "epic"], "Book length."),
    chapterLength: chapterLengthSchema,
    pov: scaleChoiceSchema(["single_pov", "dual_pov", "ensemble_pov"], "Narrative POV scale."),
    threadDensity: scaleChoiceSchema(["single_main_thread", "main_with_subthreads", "multi_thread"], "Main-thread/subthread density."),
    pace: scaleChoiceSchema(["fast", "moderate", "slow_burn"], "Pacing."),
  },
};

const storyAnchorSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["label", "role", "rules"],
  properties: {
    label: { type: "string" },
    name: { type: "string" },
    role: { type: "string" },
    rules: { type: "array", items: { type: "string" } },
  },
};

export const bookContractSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "revisionId",
    "storyPromise",
    "storyAnchors",
    "focalization",
    "startState",
    "trigger",
    "drive",
    "pressureSources",
    "stakes",
    "worldConstraints",
    "changeHorizon",
    "scale",
    "language",
    "toneRegister",
    "extras",
    "readiness",
  ],
  properties: {
    revisionId: { type: "string" },
    storyPromise: { type: "string" },
    storyAnchors: { type: "array", items: storyAnchorSchema },
    focalization: { type: "string" },
    startState: { type: "string" },
    trigger: { type: "string" },
    drive: {
      type: "object",
      additionalProperties: false,
      required: ["mode", "object"],
      properties: {
        mode: { type: "string" },
        object: { type: "string" },
      },
    },
    pressureSources: { type: "array", items: { type: "string" } },
    stakes: {
      type: "object",
      additionalProperties: false,
      required: ["external", "relational", "internal"],
      properties: {
        external: { type: "string" },
        relational: { type: "string" },
        internal: { type: "string" },
      },
    },
    worldConstraints: { type: "array", items: { type: "string" } },
    changeHorizon: { type: "string" },
    scale: bookScaleSchema,
    language: { type: "string" },
    toneRegister: { type: "string" },
    extras: {
      type: "object",
      description: "Author-defined durable custom requirements. Existing omitted entries are preserved; null removes an existing entry.",
      additionalProperties: true,
    },
    readiness: { type: "number" },
  },
};

const mainLineBeatSchema: Record<string, unknown> = {
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
    goal: { type: "string" },
    mustCover: { type: "array", items: { type: "string" } },
    forbidden: { type: "array", items: { type: "string" } },
    change: { type: "string" },
    endBoundary: { type: "string" },
    endingOpenQuestion: { type: "string" },
  },
};

export const mainLineSchema: Record<string, unknown> = {
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
    revisionId: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    arcPromise: { type: "string" },
    arcRules: { type: "array", items: { type: "string" } },
    startChapterIndex: { type: "integer", minimum: 1 },
    endChapterIndex: { type: "integer", minimum: 1 },
    beats: {
      type: "array",
      minItems: 10,
      maxItems: 10,
      items: mainLineBeatSchema,
    },
  },
};

const importEvidenceRefSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["id", "chapterIndex", "snippet", "sourceHash"],
  properties: {
    id: { type: "string" },
    chapterIndex: { type: "integer", minimum: 1 },
    title: { type: "string" },
    range: { type: "string" },
    snippet: { type: "string", maxLength: 240 },
    sourceHash: { type: "string" },
  },
};

export const importEvidenceSchema: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "latestImportedChapterIndex",
    "targetChapterIndex",
    "sourceCoverage",
    "refsByArtifactPath",
    "uncertainClaims",
    "forbiddenRetcons",
    "resolvedThreads",
    "activeThreads",
    "styleSignals",
  ],
  properties: {
    latestImportedChapterIndex: { type: "integer", minimum: 1 },
    targetChapterIndex: { type: "integer", minimum: 1 },
    sourceCoverage: { type: "object", additionalProperties: true },
    refsByArtifactPath: {
      type: "object",
      additionalProperties: {
        type: "array",
        items: importEvidenceRefSchema,
      },
    },
    uncertainClaims: { type: "array", items: { type: "string" } },
    forbiddenRetcons: { type: "array", items: { type: "string" } },
    resolvedThreads: { type: "array", items: { type: "string" } },
    activeThreads: { type: "array", items: { type: "string" } },
    styleSignals: { type: "array", items: { type: "string" } },
  },
};
