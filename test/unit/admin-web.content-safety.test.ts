import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createRequire } from "node:module";

// The admin app has no DOM test runner. Transpile the real TSX in memory and
// exercise its controlled widget callbacks without substituting the components.
const require = createRequire(new URL("../../apps/admin-web/package.json", import.meta.url));
const ts = require("typescript");
function componentModule(file: string): string {
  const code = ts.transpileModule(source(file), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText.replace(/from "([^"]+)"/g, (_match: string, module: string) => {
    const url = module === "./field" ? componentModule("field.tsx") : new URL("file://" + require.resolve(module)).href;
    return 'from "' + url + '"';
  });
  return "data:text/javascript;base64," + Buffer.from(code).toString("base64");
}

const source = (file: string) => readFileSync(new URL("../../apps/admin-web/app/components/" + file, import.meta.url), "utf8");

test("safety admin offers Jev toggle without replacing the stored Qwen key or disabling Aliyun", () => {
  const view = source("content-safety-providers-tab.tsx");
  assert.match(view, /checked={draft.llm.useJev === true}/);
  assert.match(view, /llm: { \.\.\.current.llm, useJev }/);
  assert.match(view, /value={draft.llm.modelKey}/);
  const aliyun = view.slice(view.indexOf('<h3>阿里云内容安全'));
  assert.ok(!aliyun.includes("useJev"));
});

test("statistics UI only submits date filters and displays Redis counts", () => {
  const view = source("content-safety-stats-tab.tsx");
  assert.match(view, /getContentSafetyStats\({\s*\.\.\.getDateRange\(range\),\s*}\)/);
  assert.match(view, /if \(querying.current\) return;/);
  assert.match(view, /Date.now\(\) \+ 8 \* 60 \* 60 \* 1000/);
  for (const field of ["total", "successful", "blocked", "failedOpen"]) assert.ok(view.includes("stats.summary." + field));
  for (const field of ["bySource", "byTaskType", "byApp", "p95LatencyMs", "avgLatencyMs"]) assert.ok(!view.includes(field));
  assert.match(view, /stats.byCategory/);
  assert.match(view, /stats.byModel/);
});

test("real moderation widget toggles Jev both ways, preserves Qwen, and disables only the model input", async () => {
  const { ContentSafetyProvidersTab } = await import(componentModule("content-safety-providers-tab.tsx"));
  let draft = { llm: { enabled: true, modelKey: "qwen3.6-flash", timeoutMs: 5000, useJev: false },
    aliyun: { enabled: true, endpoint: "https://green.example.test", region: "cn-shanghai", service: "test", timeoutMs: 5000 } };
  const render = () => ContentSafetyProvidersTab({ draft, passwordOptions: [], onDraftChange: (update: any) => { draft = update(draft); } });
  const findField = (tree: any, label: string): any => {
    if (!tree || typeof tree !== "object") return undefined;
    if (tree.props?.label === label) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) {
      const found = findField(child, label);
      if (found) return found;
    }
  };
  const toggle = findField(render(), "使用 Jev 审核").props.children[0];
  assert.equal(toggle.props.checked, false);
  toggle.props.onChange(true);
  assert.equal(draft.llm.useJev, true);
  assert.equal(draft.llm.modelKey, "qwen3.6-flash");
  assert.equal(findField(render(), "原有 LLM Model Key").props.children.props.disabled, true);
  assert.equal(findField(render(), "Endpoint").props.children.props.disabled, undefined);
  findField(render(), "使用 Jev 审核").props.children[0].props.onChange(false);
  assert.equal(draft.llm.modelKey, "qwen3.6-flash");
  assert.equal(findField(render(), "原有 LLM Model Key").props.children.props.disabled, false);
});
