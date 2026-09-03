import assert from "node:assert/strict";
import test from "node:test";

import {
  selectAiNovelChatModelKey,
} from "../../src/modules/ai-novel/ai-novel-model-weight-selection.ts";
import type { AiNovelModelSelectionConfig } from "../../src/shared/types.ts";

function config(weights: number[]): AiNovelModelSelectionConfig {
  return {
    schemaVersion: 1,
    chat: {
      default: weights.map((weight, index) => ({
        modelKey: `model-${index + 1}`,
        weight,
      })),
    },
  };
}

test("AINovel weighted model selection follows cumulative array weights", () => {
  const selection = config([50, 30, 20]);
  const identity = { did: "device_abc", uid: "user_xyz" };
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.499), "model-1");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.5), "model-2");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.799), "model-2");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.8), "model-3");
  assert.equal(selectAiNovelChatModelKey(selection, identity, () => 0.999), "model-3");
});

test("AINovel weighted selection delegates DID and UID to common affinity", () => {
  let received: [string | undefined, string | undefined] | undefined;
  const selected = selectAiNovelChatModelKey(
    config([50, 50]),
    { did: "device_abc", uid: "user_xyz" },
    (did, uid) => {
      received = [did, uid];
      return 0.75;
    },
  );
  assert.deepEqual(received, ["device_abc", "user_xyz"]);
  assert.equal(selected, "model-2");
});
