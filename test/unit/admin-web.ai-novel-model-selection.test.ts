import assert from "node:assert/strict";
import test from "node:test";

import { parseAiNovelModelSelectionText } from "../../apps/admin-web/app/lib/ai-novel-model-selection.ts";

const AVAILABLE_MODELS = ["model-a", "model-b"];

test("AINovel model JSON parser accepts and normalizes valid weighted models", () => {
  assert.deepEqual(
    parseAiNovelModelSelectionText(
      JSON.stringify({
        schemaVersion: 1,
        chat: {
          default: [
            { modelKey: " model-a ", weight: 35.5 },
            { modelKey: "model-b", weight: 64.5 },
          ],
        },
      }),
      AVAILABLE_MODELS,
    ),
    {
      schemaVersion: 1,
      chat: {
        default: [
          { modelKey: "model-a", weight: 35.5 },
          { modelKey: "model-b", weight: 64.5 },
        ],
      },
    },
  );
});

test("AINovel model JSON parser rejects syntax errors and unsupported fields", () => {
  assert.throws(
    () => parseAiNovelModelSelectionText("{", AVAILABLE_MODELS),
    /JSON|合法/,
  );
  assert.throws(
    () => parseAiNovelModelSelectionText(
      JSON.stringify({
        schemaVersion: 1,
        chat: {
          default: [{ modelKey: "model-a", weight: 100 }],
          write_turn: [{ modelKey: "model-b", weight: 100 }],
        },
      }),
      AVAILABLE_MODELS,
    ),
    /不支持的字段.*write_turn/,
  );
});

test("AINovel model JSON parser rejects unknown, duplicate, and invalid weights", () => {
  assert.throws(
    () => parseAiNovelModelSelectionText(
      JSON.stringify({
        schemaVersion: 1,
        chat: { default: [{ modelKey: "missing", weight: 100 }] },
      }),
      AVAILABLE_MODELS,
    ),
    /不存在/,
  );
  assert.throws(
    () => parseAiNovelModelSelectionText(
      JSON.stringify({
        schemaVersion: 1,
        chat: {
          default: [
            { modelKey: "model-a", weight: 50 },
            { modelKey: "model-a", weight: 50 },
          ],
        },
      }),
      AVAILABLE_MODELS,
    ),
    /不能重复/,
  );
  assert.throws(
    () => parseAiNovelModelSelectionText(
      JSON.stringify({
        schemaVersion: 1,
        chat: {
          default: [
            { modelKey: "model-a", weight: 60 },
            { modelKey: "model-b", weight: 30 },
          ],
        },
      }),
      AVAILABLE_MODELS,
    ),
    /必须等于 100/,
  );
});
