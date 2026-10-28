import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("../../scripts/frogsleep-support-observation.ts", import.meta.url));
function run(path: string) {
  const result = spawnSync(process.execPath, ["--experimental-transform-types", script, path], { encoding: "utf8" });
  assert.equal(result.error, undefined);
  return { exit: result.status, result: JSON.parse(result.stdout) };
}
async function withInput(input: unknown, check: (path: string) => void) {
  const directory = await mkdtemp(join(tmpdir(), "support-observation-cli-中文 空格-"));
  try {
    const path = join(directory, "input.json");
    await writeFile(path, JSON.stringify(input));
    check(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("CLI empty checked-in example returns not_ready JSON and a nonzero exit", () => {
  const path = fileURLToPath(new URL("../../docs/frogsleep-support-observation-input.example.json", import.meta.url));
  const { exit, result } = run(path);
  assert.equal(exit, 2);
  assert.equal(result.status, "not_ready");
  assert.equal(result.guardrail, null);
  assert.equal(result.releaseReady, false);
  assert.equal(result.improvementClaim, false);
  assert.ok(result.missing.includes("qualified_display_source"));
});
test("CLI historical integer-only input cannot qualify noteOnly or missing guardrails", async () => {
  const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-15T00:00:00Z", users: 40,
    noteOnly: 999999, jointCompletions: 0, focusStarted: 10, focusCompleted: 5, sleepStarted: 4, sleepCompleted: 2 };
  const trial = { ...window, from: "2026-09-01T00:00:00Z", to: "2026-09-15T00:00:00Z" };
  await withInput({ baseline: window, trial, control: trial, guardrails: {} }, path => {
    const { exit, result } = run(path);
    assert.equal(exit, 2);
    assert.equal(result.status, "not_ready");
    assert.ok(result.missing.includes("trial.noteOnly.source"));
    assert.ok(result.missing.includes("guardrails.revoke_rate"));
  });
});
test("CLI supplied zeros cannot hide a missing display source or real data provenance", async () => {
  const window = { from: "2026-08-01T00:00:00Z", to: "2026-08-15T00:00:00Z", users: 40,
    noteOnly: 0, jointCompletions: 0, focusStarted: 10, focusCompleted: 5, sleepStarted: 4, sleepCompleted: 2 };
  const trial = { ...window, from: "2026-09-01T00:00:00Z", to: "2026-09-15T00:00:00Z" };
  const guardrails = { push_opt_out_rate: 0, revoke_rate: 0, block_rate: 0, report_rate: 0, complaint_rate: 0 };
  await withInput({ baseline: window, trial, control: trial, guardrails }, path => {
    const { exit, result } = run(path);
    assert.equal(exit, 2);
    assert.equal(result.guardrail, null);
    assert.ok(result.missing.includes("trial.real_data"));
    assert.ok(result.missing.includes("trial.noteOnly.source"));
  });
});

// Deliberately fabricated assertions must not become a production source registration.
function claimedWindow(from: string, to: string) {
  return { from, to, users: 40, noteOnly: 1, jointCompletions: 0,
    focusStarted: 10, focusCompleted: 5, sleepStarted: 4, sleepCompleted: 2,
    provenance: { dataKind: "real", evidenceRef: "fabricated-unit-test-reference",
      noteOnly: { sourceId: "self-registered", status: "qualified", source: "qualified_display_aggregate",
        evidenceRef: "fabricated-unit-test-qualification", queryVersion: "v1", unit: "relationship_group_week",
        deduplication: "first_qualified_display_then_relationship_group_week", from, to,
        qualification: { recipient: true, currentAuthorization: true, unexpired: true, foregroundVisible: true, unprotected: true } } } };
}
test("CLI cannot accept a source catalog supplied by its own aggregate JSON", async () => {
  const baseline = claimedWindow("2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z");
  const trial = claimedWindow("2026-09-01T00:00:00Z", "2026-09-15T00:00:00Z");
  const guardrails = { push_opt_out_rate: 0, revoke_rate: 0, block_rate: 0, report_rate: 0, complaint_rate: 0 };
  await withInput({ baseline, trial, control: trial, guardrails, qualifiedDisplaySources: [trial.provenance.noteOnly] }, path => {
    const { exit, result } = run(path);
    assert.equal(exit, 2);
    assert.equal(result.status, "not_ready");
    assert.equal(result.guardrail, null);
    for (const group of ["baseline", "trial", "control"]) assert.ok(result.missing.includes(`${group}.noteOnly.registered_source`));
  });
});
