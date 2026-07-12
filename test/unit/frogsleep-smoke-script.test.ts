import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";

test("FrogSleep smoke script uses canonical product API paths", () => {
  const source = readFileSync("scripts/frogsleep-zook-smoke.mjs", "utf8");

  assert.match(source, /\/api\/v1\/frogsleep/);
  assert.doesNotMatch(source, /["'`]\/v1\//);
});
