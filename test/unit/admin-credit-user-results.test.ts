import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const adminRoot = new URL("../../apps/admin-web/", import.meta.url);
const require = createRequire(new URL("package.json", adminRoot));

test("credit search results render directly with a bounded scroll area and selectable identities", async () => {
  const esbuild = require("esbuild") as typeof import("esbuild");
  const React = require("react") as typeof import("react");
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  const directory = await mkdtemp(join(new URL("node_modules/", adminRoot).pathname, ".credit-test-"));
  try {
    const output = join(directory, "results.mjs");
    await esbuild.build({ entryPoints: [new URL("app/components/ai-novel-credits/credit-user-results.tsx", adminRoot).pathname], outfile: output, bundle: true, packages: "external", format: "esm", platform: "node", jsx: "automatic", loader: { ".css": "empty" }, logLevel: "silent" });
    const { CreditUserResults } = await import(pathToFileURL(output).href);
    const users = Array.from({ length: 9 }, (_, index) => ({ uid: `uid-${index}`, phone: `phone-${index}`, email: `email-${index}@example.invalid` }));
    const html = renderToStaticMarkup(React.createElement(CreditUserResults, { users, selected: "uid-1", disabled: false, onSelect: () => {} }));
    assert.equal((html.match(/type="radio"/g) ?? []).length, 9);
    assert.match(html, /checked="" value="uid-1"/);
    assert.match(html, /phone-0/);
    assert.match(html, /email-0@example\.invalid/);
    assert.match(html, /ant-tag-blue/);
    assert.match(html, /ant-tag-green/);
    assert.match(html, /ant-tag-purple/);
    const css = await readFile(new URL("app/components/ai-novel-credits/credit-user-results.css", adminRoot), "utf8");
    assert.match(css, /max-height:\s*300px/);
    assert.match(css, /height:\s*60px/);
    assert.match(css, /overflow-y:\s*auto/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
