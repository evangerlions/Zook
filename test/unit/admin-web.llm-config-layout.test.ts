import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const configTabPath = new URL("../../apps/admin-web/app/components/llm-config-tab.tsx", import.meta.url);
const configStylePath = new URL("../../apps/admin-web/app/styles/llm-config.css", import.meta.url);
const routeStylePath = new URL("../../apps/admin-web/app/styles/llm-config-routes.css", import.meta.url);
const shellStylePath = new URL("../../apps/admin-web/app/styles/shell.css", import.meta.url);
const seriesTonePath = new URL("../../apps/admin-web/app/lib/llm-series-tone.ts", import.meta.url);

const { getLlmSeriesToneClass } = await import(seriesTonePath.href);

test("admin web llm form keeps global settings in a compact group", async () => {
  const source = await readFile(configTabPath, "utf8");

  assert.match(source, /className=\"llm-global-grid\"/);
  assert.match(source, /label=\"启用 LLM 服务\"/);
  assert.match(source, /label=\"启用上游路由熔断\"/);
  assert.match(source, /label=\"默认模型\"/);
});

test("admin web llm model tone follows the first display word", () => {
  assert.equal(getLlmSeriesToneClass("Qwen 3.8 Max"), "model-card--qwen");
  assert.equal(getLlmSeriesToneClass("DeepSeek V4 Pro"), "model-card--deepseek");
  assert.equal(getLlmSeriesToneClass("Kimi K3"), "model-card--kimi");
  assert.equal(getLlmSeriesToneClass("GLM 5.3"), "model-card--glm");
  assert.equal(getLlmSeriesToneClass("Qwen 3.8 Flash"), getLlmSeriesToneClass("Qwen 3.7 Plus"));
  assert.equal(getLlmSeriesToneClass("qwen3.8-flash"), "model-card--qwen");
});

test("admin web sidebar collapse leaves only the protruding expand arrow", async () => {
  const stylesheet = await readFile(shellStylePath, "utf8");

  assert.match(stylesheet, /\.console-shell\.is-sidebar-collapsed\s*\{[\s\S]*grid-template-columns: 0 minmax\(0, 1fr\)/);
  assert.match(stylesheet, /\.sidebar\.is-collapsed\s*\{[\s\S]*width: 0/);
  assert.match(stylesheet, /\.sidebar\.is-collapsed\s*\{[\s\S]*z-index: 20/);
  assert.match(stylesheet, /\.sidebar\.is-collapsed \.sidebar-toggle[\s\S]*right: -28px/);
  assert.match(stylesheet, /\.sidebar\.is-collapsed \.sidebar-nav[\s\S]*display: none/);
});

test("admin web llm compact layout preserves dense desktop and mobile breakpoints", async () => {
  const stylesheet = await readFile(configStylePath, "utf8");
  const routeStylesheet = await readFile(routeStylePath, "utf8");

  assert.match(stylesheet, /\.llm-config-page \.provider-list[\s\S]*minmax\(580px, 1fr\)/);
  assert.match(stylesheet, /\.llm-config-page \.provider-list \.config-form-grid[\s\S]*minmax\(0, 0\.55fr\)/);
  assert.match(stylesheet, /\.llm-config-page \.provider-list \.field[\s\S]*min-width: 0/);
  assert.match(routeStylesheet, /\.llm-config-page \.route-item-fields[\s\S]*minmax\(190px, 1\.8fr\)/);
  assert.match(`${stylesheet}\n${routeStylesheet}`, /@media \(max-width: 640px\)/);
});
