import assert from "node:assert/strict";
import test from "node:test";
import { defineAiNovelTool } from "../../src/modules/ai-novel/tools/ai-novel-tool-definition.ts";
import {
  filterAiNovelAgentTools,
  requireVisibleAiNovelTool,
} from "../../src/modules/ai-novel/tools/ai-novel-tool-visibility.ts";

const existing = defineAiNovelTool({ name: "existing", description: "fixture", inputSchema: {}, visibility: {} });
const introduced = defineAiNovelTool({
  name: "introduced", description: "fixture", inputSchema: {},
  visibility: { minAppVersion: "1.8.0", agentProtocol: "pi-v1" },
});
const context = { suppliedTools: [existing.name, introduced.name] };

test("new tools require a recognized version at or above their minimum", () => {
  for (const appVersion of [undefined, "", "unknown", "1.7.99", "1.8.0-beta.1"]) {
    assert.deepEqual(filterAiNovelAgentTools([existing, introduced], { context, agentProtocol: "pi-v1", appVersion }), [existing]);
  }
  for (const appVersion of ["1.8.0", "1.8.0+1080000", "1.8.1", "1.10.0", "2.0.0"]) {
    assert.deepEqual(filterAiNovelAgentTools([existing, introduced], { context, agentProtocol: "pi-v1", appVersion }), [existing, introduced]);
  }
});

test("legacy requests preserve old tools and cannot bypass new tool gates", () => {
  for (const appVersion of [undefined, "1.7.1", "1.8.0"]) {
    assert.deepEqual(filterAiNovelAgentTools([existing, introduced], { appVersion }), [existing]);
  }
  const versionOnly = defineAiNovelTool({ ...existing, name: "version-only", visibility: { minAppVersion: "1.8.0" } });
  assert.deepEqual(filterAiNovelAgentTools([versionOnly], { appVersion: "1.8.0" }), [versionOnly]);
  assert.deepEqual(filterAiNovelAgentTools([versionOnly], { appVersion: "1.7.1" }), []);
});

test("version and protocol do not replace client capability declarations", () => {
  for (const supplied of [undefined, {}, { suppliedTools: "introduced" }, { suppliedTools: ["unrecognized"] }]) {
    assert.deepEqual(filterAiNovelAgentTools([introduced], { context: supplied, agentProtocol: "pi-v1", appVersion: "1.8.0" }), []);
  }
});

test("skill visibility remains explicit and does not depend on the tool name", () => {
  const skill = defineAiNovelTool({ ...existing, name: "skill", visibility: { agentProtocol: "pi-v1", requiresSkills: true } });
  const supplied = { suppliedTools: [skill.name] };
  assert.deepEqual(filterAiNovelAgentTools([skill], { context: supplied, agentProtocol: "pi-v1", appVersion: "1.8.0" }), []);
  assert.deepEqual(filterAiNovelAgentTools([skill], { context: supplied, agentProtocol: "pi-v1", appVersion: "1.8.0", skillsEnabled: true }), [skill]);
});

test("server-required tools ignore suppliedTools but enforce compatibility", () => {
  assert.equal(requireVisibleAiNovelTool(existing, {}), existing);
  assert.equal(requireVisibleAiNovelTool(introduced, { appVersion: "1.8.0", agentProtocol: "pi-v1" }), introduced);
  assert.throws(() => requireVisibleAiNovelTool(introduced, { appVersion: "1.7.1", agentProtocol: "pi-v1" }),
    (error: unknown) => (error as { code?: string }).code === "REQ_INVALID_BODY");
});

test("invalid minimum versions fail at the definition boundary", () => {
  assert.throws(() => defineAiNovelTool({ ...existing, visibility: { minAppVersion: "latest" } }), /minimum.*version/i);
});

test("maximum version is optional and inclusive, with numeric release comparison", () => {
  const bounded = defineAiNovelTool({ ...existing, visibility: { minAppVersion: "1.8.0", maxAppVersion: "1.9.0" } });
  for (const appVersion of ["1.8.0", "1.8.99", "1.9.0", "1.9.0+1090099"]) {
    assert.deepEqual(filterAiNovelAgentTools([bounded], { appVersion }), [bounded]);
  }
  for (const appVersion of [undefined, "invalid", "1.7.99", "1.9.1", "1.10.0", "2.0.0"]) {
    assert.deepEqual(filterAiNovelAgentTools([bounded], { appVersion }), [], String(appVersion));
  }
  assert.deepEqual(filterAiNovelAgentTools([existing], { appVersion: "999.0.0" }), [existing]);
  assert.deepEqual(filterAiNovelAgentTools([introduced], { context, agentProtocol: "pi-v1", appVersion: "999.0.0" }), [introduced]);
});

test("maximum-only and single-release ranges are supported", () => {
  const maximumOnly = defineAiNovelTool({ ...existing, visibility: { maxAppVersion: "1.8.0" } });
  for (const appVersion of ["0.9.0", "1.7.99", "1.8.0+1080000"]) {
    assert.deepEqual(filterAiNovelAgentTools([maximumOnly], { appVersion }), [maximumOnly]);
  }
  for (const appVersion of [undefined, "invalid", "1.8.1"]) {
    assert.deepEqual(filterAiNovelAgentTools([maximumOnly], { appVersion }), []);
  }
  const singleRelease = defineAiNovelTool({ ...existing, visibility: { minAppVersion: "1.8.0", maxAppVersion: "1.8.0" } });
  assert.deepEqual(filterAiNovelAgentTools([singleRelease], { appVersion: "1.8.0" }), [singleRelease]);
});

test("maximum version composes with Pi capabilities and required-tool checks", () => {
  const bounded = defineAiNovelTool({ ...introduced, visibility: { ...introduced.visibility, maxAppVersion: "1.9.0" } });
  assert.deepEqual(filterAiNovelAgentTools([bounded], { context, appVersion: "1.9.0" }), []);
  assert.deepEqual(filterAiNovelAgentTools([bounded], { context: {}, agentProtocol: "pi-v1", appVersion: "1.9.0" }), []);
  assert.deepEqual(filterAiNovelAgentTools([bounded], { context, agentProtocol: "pi-v1", appVersion: "1.9.0" }), [bounded]);
  assert.throws(() => requireVisibleAiNovelTool(bounded, { appVersion: "1.9.1", agentProtocol: "pi-v1" }),
    (error: unknown) => (error as { code?: string }).code === "REQ_INVALID_BODY");
});

test("invalid upper bounds and reversed ranges fail at the definition boundary", () => {
  for (const maxAppVersion of ["", "latest", "1.8.0-beta.1"]) {
    assert.throws(() => defineAiNovelTool({ ...existing, visibility: { maxAppVersion } }), /maximum.*version/i);
  }
  assert.throws(() => defineAiNovelTool({ ...existing, visibility: { minAppVersion: "1.9.0", maxAppVersion: "1.8.0" } }), /version range/i);
});
