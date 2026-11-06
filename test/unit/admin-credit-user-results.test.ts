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
    const { CreditUserResults, CreditSelectedUser } = await import(pathToFileURL(output).href);
    const users = Array.from({ length: 9 }, (_, index) => ({ uid: `uid-${index}`, phone: `phone-${index}`, email: `email-${index}@example.invalid` }));
    const html = renderToStaticMarkup(React.createElement(CreditUserResults, { users, selected: "uid-1", disabled: false, onSelect: () => {} }));
    assert.equal((html.match(/type="radio"/g) ?? []).length, 9);
    assert.match(html, /checked="" value="uid-1"/);
    assert.match(html, /phone-0/);
    assert.match(html, /email-0@example\.invalid/);
    assert.match(html, /ant-tag-blue/);
    assert.match(html, /credit-user-result-number">1</);
    assert.match(html, /credit-user-result-number">9</);
    assert.match(html, /aria-label="手机号"/);
    assert.match(html, /aria-label="邮箱"/);
    assert.equal(renderToStaticMarkup(React.createElement(CreditSelectedUser, {})), "");
    const summary = renderToStaticMarkup(React.createElement(CreditSelectedUser, { user: users[1] }));
    assert.match(summary, /已选择/);
    assert.match(summary, /uid-1/);
    assert.match(summary, /phone-1/);
    assert.match(summary, /email-1@example\.invalid/);
    assert.doesNotMatch(summary, /uid-0/);
    const css = await readFile(new URL("app/components/ai-novel-credits/credit-user-results.css", adminRoot), "utf8");
    assert.match(css, /max-height:\s*300px/);
    assert.match(css, /height:\s*60px/);
    assert.match(css, /overflow-y:\s*auto/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("credit presets fill the chosen amount and respect the disabled state", async () => {
  const esbuild = require("esbuild") as typeof import("esbuild");
  const React = require("react") as typeof import("react");
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  const directory = await mkdtemp(join(new URL("node_modules/", adminRoot).pathname, ".credit-test-"));
  try {
    const output = join(directory, "presets.mjs");
    await esbuild.build({ entryPoints: [new URL("app/components/ai-novel-credits/credit-grant-presets.tsx", adminRoot).pathname], outfile: output, bundle: true, packages: "external", format: "esm", platform: "node", jsx: "automatic", logLevel: "silent" });
    const { CreditGrantPresets } = await import(pathToFileURL(output).href);
    let selected = 0;
    const props = { points: null, disabled: false, onSelect: (value: number) => { selected = value; } };
    const options = React.Children.toArray(CreditGrantPresets(props).props.children) as Array<React.ReactElement<{ onClick: () => void; children: number }>>;
    assert.deepEqual(options.map(option => option.props.children), [10, 50, 100, 500, 1000]);
    options[2].props.onClick();
    assert.equal(selected, 100);
    const disabledHtml = renderToStaticMarkup(React.createElement(CreditGrantPresets, { ...props, disabled: true }));
    assert.equal((disabledHtml.match(/disabled=""/g) ?? []).length, 5);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("grant recipient tooltip shows recorded contacts and identifies legacy data", async () => {
  const esbuild = require("esbuild") as typeof import("esbuild");
  const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
  const directory = await mkdtemp(join(new URL("node_modules/", adminRoot).pathname, ".credit-test-"));
  try {
    const output = join(directory, "recipient.mjs");
    await esbuild.build({ entryPoints: [new URL("app/components/ai-novel-credits/credit-grant-recipient.tsx", adminRoot).pathname], outfile: output, bundle: true, packages: "external", format: "esm", platform: "node", jsx: "automatic", logLevel: "silent" });
    const { CreditGrantRecipient } = await import(pathToFileURL(output).href);
    const record = { uid: "user-1", phone: "+12025550100", email: "person@example.invalid", contactSource: "snapshot" };
    const snapshot = CreditGrantRecipient({ record });
    const title = renderToStaticMarkup(snapshot.props.title);
    assert.match(title, /\+12025550100/);
    assert.match(title, /person@example\.invalid/);
    assert.doesNotMatch(title, /当前联系方式/);
    const legacy = CreditGrantRecipient({ record: { ...record, contactSource: "current" } });
    assert.match(renderToStaticMarkup(legacy.props.title), /历史记录：当前联系方式/);
    const absent = CreditGrantRecipient({ record: { ...record, contactSource: "unavailable", phone: null, email: null } });
    assert.match(renderToStaticMarkup(absent.props.title), /联系方式不可用/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
