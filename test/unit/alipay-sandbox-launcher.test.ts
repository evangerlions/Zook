import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAlipaySandboxConfig, applyLocalDefaults } from "../../scripts/alipay-sandbox-config.ts";

const config = `ALIPAY_AI_NOVEL_ENVIRONMENT=sandbox
ALIPAY_AI_NOVEL_PRIVATE_KEY_PATH=/dev/null
ALIPAY_AI_NOVEL_PUBLIC_KEY_PATH=/dev/null`;

test("launcher uses sandbox credentials instead of inherited Alipay settings", () => {
  const env: NodeJS.ProcessEnv = { APP_ENV: "production", ALIPAY_AI_NOVEL_APP_ID: "wrong",
    ALIPAY_AI_NOVEL_PRICES_JSON: '{"plus_monthly":3800}', PORT: "3210" };
  applyAlipaySandboxConfig(env, config);
  assert.equal(env.ALIPAY_AI_NOVEL_APP_ID, undefined);
  assert.equal(env.ALIPAY_AI_NOVEL_ENVIRONMENT, "sandbox");
  assert.equal(env.ALIPAY_AI_NOVEL_PRICES_JSON, undefined);
  assert.equal(env.APP_ENV, "local");
  assert.equal(env.PORT, "3210");
});

test("launcher refuses production and missing key files", () => {
  assert.throws(() => applyAlipaySandboxConfig({}, config.replace("sandbox", "production")));
  assert.throws(() => applyAlipaySandboxConfig({}, config.replace("/dev/null", "/no-such-alipay-key")));
});

test("local defaults do not overwrite existing configuration", () => {
  const env: NodeJS.ProcessEnv = { EXISTING: "chosen" };
  applyLocalDefaults(env, "EXISTING=ignored\nMISSING=default");
  assert.equal(env.EXISTING, "chosen");
  assert.equal(env.MISSING, "default");
});
