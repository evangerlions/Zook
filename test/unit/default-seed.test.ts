import assert from "node:assert/strict";
import test from "node:test";

import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";

test("default seed keeps ai_novel branded as OrangeWrite", () => {
  const seed = buildDefaultSeed();
  const app = seed.apps?.find((item) => item.id === "ai_novel");

  assert.equal(app?.name, "OrangeWrite");
  assert.deepEqual(app?.nameI18n, {
    "zh-CN": "橘子写作",
    "en-US": "OrangeWrite",
  });
});
