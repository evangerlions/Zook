import assert from "node:assert/strict";
import { test } from "node:test";
import { applyLocalDefaults } from "../../scripts/local-dev-config.ts";

test("local startup loads defaults without replacing existing credentials or deployment identity", () => {
  const env: NodeJS.ProcessEnv = { EXISTING: "chosen", APP_ENV: "dev" };
  applyLocalDefaults(env, "EXISTING=ignored\nMISSING=default");
  assert.equal(env.EXISTING, "chosen");
  assert.equal(env.MISSING, "default");
  assert.equal(env.APP_ENV, "dev");
  const empty: NodeJS.ProcessEnv = {};
  applyLocalDefaults(empty, "");
  assert.equal(empty.APP_ENV, "local");
});
