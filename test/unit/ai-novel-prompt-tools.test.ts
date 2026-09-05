import assert from "node:assert/strict";
import test from "node:test";
import {
  CHAPTER_DRAFT_TOOLS,
  HISTORY_CHAPTER_QA_TOOLS,
  READ_TOOL,
  WRITE_TURN_TOOLS,
} from "../../src/modules/ai-novel/prompts/ai-novel-prompt-tools.ts";

function writeDraftSchema(
  tools: readonly { name: string; inputSchema: unknown }[],
) {
  const tool = tools.find((candidate) => candidate.name === "write_draft");
  assert.ok(tool);
  return tool.inputSchema as Record<string, unknown>;
}

test("write_draft exposes the same optional Markdown-cleanup opt-out in both authoring scenes", () => {
  const writeTurnSchema = writeDraftSchema(WRITE_TURN_TOOLS);
  const chapterDraftSchema = writeDraftSchema(CHAPTER_DRAFT_TOOLS);

  assert.deepEqual(writeTurnSchema, chapterDraftSchema);
  assert.equal(writeTurnSchema.additionalProperties, false);
  assert.deepEqual(writeTurnSchema.required, ["content"]);

  const properties = writeTurnSchema.properties as Record<string, unknown>;
  assert.deepEqual(properties.disableMdClean, {
    type: "boolean",
    description:
      "Markdown cleanup is enabled by default. Set literal true only when the author explicitly requests preserving literal Markdown syntax.",
  });
  assert.equal(
    (writeTurnSchema.required as string[]).includes("disableMdClean"),
    false,
  );
});

test("read exposes the restricted virtual-path schema in agent scenes", () => {
  assert.equal(READ_TOOL.name, "read");
  assert.deepEqual(READ_TOOL.inputSchema, {
    type: "object",
    additionalProperties: false,
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "Exact virtual path from the approved Skill catalog or its referenced files.",
      },
      offset: { type: "integer", minimum: 1 },
      limit: { type: "integer", minimum: 1 },
    },
  });
  assert.equal(WRITE_TURN_TOOLS[0]?.name, "read");
  assert.equal(
    HISTORY_CHAPTER_QA_TOOLS.some((tool) => tool.name === "read"),
    false,
  );
  assert.equal(
    CHAPTER_DRAFT_TOOLS.some((tool) => tool.name === "read"),
    false,
  );
});
