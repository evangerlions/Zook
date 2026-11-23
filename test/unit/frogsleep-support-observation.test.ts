import assert from "node:assert/strict";
import test from "node:test";
import { supportObservation } from "../../src/modules/frogsleep/buddy-support/buddy-support-observation.ts";

const sources = [{ id: "unit-test-only-source", queryVersion: "unit-test-query", evidenceRef: "unit-test-only-qualification" }];
const now = Date.parse("2026-10-25T00:00:00Z");
const metrics = ["push_opt_out_rate", "revoke_rate", "block_rate", "report_rate", "complaint_rate"] as const;

// Hypothetical source attestations exercise the contract, never real observation evidence.
function window(from = "2026-09-01T00:00:00Z", to = "2026-09-15T00:00:00Z") {
  return { from, to, users: 40, noteOnly: 4, jointCompletions: 2,
    focusStarted: 10, focusCompleted: 5, sleepStarted: 4, sleepCompleted: 2,
    provenance: { dataKind: "real", evidenceRef: "unit-test-only-aggregate",
      noteOnly: { sourceId: "unit-test-only-source", status: "qualified", source: "qualified_display_aggregate", evidenceRef: "unit-test-only-qualification",
        queryVersion: "unit-test-query", unit: "relationship_group_week",
        deduplication: "first_qualified_display_then_relationship_group_week", from, to,
        qualification: { recipient: true, currentAuthorization: true, unexpired: true,
          foregroundVisible: true, unprotected: true } } } };
}
function complete() {
  return { baseline: window("2026-08-01T00:00:00Z", "2026-08-15T00:00:00Z"), trial: window(), control: window(),
    guardrails: Object.fromEntries(metrics.map(metric => [metric, 0])) };
}
function notReady(input: unknown, reason?: string) {
  const result = supportObservation(input, now, sources);
  assert.equal(result.status, "not_ready");
  assert.equal(result.ready, false);
  assert.equal(result.releaseReady, false);
  assert.equal(result.improvementClaim, false);
  assert.equal(result.guardrail, null);
  if (reason) assert.ok(result.missing.includes(reason), JSON.stringify(result));
  return result;
}

test("empty input is explicitly not ready and cannot imply enabled guardrails", () => {
  const result = notReady({ baseline: null, trial: null, control: null, guardrails: {} });
  for (const metric of metrics) assert.ok(result.missing.includes(`guardrails.${metric}`));
  for (const group of ["baseline", "trial", "control"]) assert.ok(result.missing.includes(`${group}.window`));
});
test("missing guardrail object does not default to an all-zero rollout", () => {
  const input = complete();
  notReady({ ...input, guardrails: undefined }, "guardrails.revoke_rate");
  notReady({ ...input, guardrails: null }, "guardrails.revoke_rate");
});
for (const metric of metrics) {
  test(`${metric} must be an explicit finite rate in [0,1]`, () => {
    for (const value of [undefined, null, "0", NaN, Infinity, -0.01, 1.01]) {
      const input = complete();
      notReady({ ...input, guardrails: { ...input.guardrails, [metric]: value } }, `guardrails.${metric}`);
    }
  });
}
test("explicit measured zero rates are accepted only with qualified real-window provenance", () => {
  const result = supportObservation(complete(), now, sources);
  assert.equal(result.status, "review");
  assert.equal(result.ready, true);
  assert.equal(result.guardrail?.enabled, true);
  assert.equal(result.releaseReady, false);
  assert.equal(result.improvementClaim, false);
});
test("complete breached guardrails still stop rather than allowing review", () => {
  const input = complete(); input.guardrails.revoke_rate = 0.1;
  const result = supportObservation(input, now, sources);
  assert.equal(result.status, "stop");
  assert.equal(result.ready, false);
  assert.deepEqual(result.guardrail?.disabledCapabilities, ["prompts", "push", "growth"]);
});
test("a known breach plus missing rates is not a complete safety evaluation", () => {
  notReady({ ...complete(), guardrails: { revoke_rate: 0.1 } }, "guardrails.block_rate");
});
for (const group of ["baseline", "trial", "control"] as const) {
  test(`${group} requires real aggregate provenance and a qualified noteOnly source`, () => {
    const input = complete();
    notReady({ ...input, [group]: { ...input[group], provenance: undefined } }, `${group}.real_data`);
    for (const dataKind of ["qa", "synthetic", undefined]) {
      input[group].provenance.dataKind = dataKind as string;
      notReady(input, `${group}.real_data`);
    }
  });
  test(`${group} with missing real data remains not ready`, () => {
    notReady({ ...complete(), [group]: null }, `${group}.window`);
  });
}
test("unqualified and proxy noteOnly sources cannot substitute for actual display", () => {
  for (const source of [undefined, "server_sent", "acknowledgement", "local_views", "page_open"]) {
    const input = complete(); input.trial.provenance.noteOnly.source = source as string;
    notReady(input, "trial.noteOnly.source");
  }
});
test("zero noteOnly is not proof of a collected display metric", () => {
  const input = complete(); input.trial.noteOnly = 0;
  input.trial.provenance.noteOnly.status = "not_collected";
  notReady(input, "trial.noteOnly.status");
});
test("an asserted qualified source still requires references and a query version", () => {
  for (const key of ["evidenceRef", "queryVersion"] as const) {
    const input = complete(); input.trial.provenance.noteOnly[key] = " ";
    notReady(input, `trial.noteOnly.${key}`);
  }
  const input = complete(); input.trial.provenance.evidenceRef = "";
  notReady(input, "trial.aggregate_evidence");
});
test("noteOnly must describe the exact window, relationship-week unit and first-display deduplication", () => {
  for (const key of ["from", "to", "unit", "deduplication"] as const) {
    const input = complete(); input.trial.provenance.noteOnly[key] = "mismatch";
    notReady(input, `trial.noteOnly.${key}`);
  }
});
test("all recipient/display qualification conditions must be attested", () => {
  for (const key of ["recipient", "currentAuthorization", "unexpired", "foregroundVisible", "unprotected"] as const) {
    const input = complete(); input.trial.provenance.noteOnly.qualification[key] = false;
    notReady(input, `trial.noteOnly.qualification.${key}`);
  }
});
test("a source label without qualification data cannot crash or qualify", () => {
  const input = complete();
  notReady({ ...input, trial: { ...input.trial, provenance: { ...input.trial.provenance,
    noteOnly: { sourceId: "unit-test-only-source", status: "qualified", source: "qualified_display_aggregate" } } } }, "trial.noteOnly.unit");
});
test("incomplete, future, or invalid windows return not ready rather than comparison", () => {
  for (const [from, to] of [["invalid", "2026-09-15T00:00:00Z"],
    ["2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z"],
    ["2026-10-20T00:00:00Z", "2026-11-03T00:00:00Z"]]) {
    const input = complete(); input.trial = window(from, to);
    notReady(input, "trial.completed_14_days");
  }
});
test("control must be concurrent and baseline must precede the trial", () => {
  let input = complete(); input.control = window("2026-09-02T00:00:00Z", "2026-09-16T00:00:00Z");
  notReady(input, "control.concurrent_window");
  input = complete(); input.baseline = window("2026-08-20T00:00:00Z", "2026-09-03T00:00:00Z");
  notReady(input, "baseline.precedes_trial");
});
test("missing, unsafe and contradictory counts are not data readiness", () => {
  for (const value of [null, undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "4"]) {
    const input = complete();
    notReady({ ...input, trial: { ...input.trial, noteOnly: value } }, "trial.counts.noteOnly");
  }
  const input = complete(); input.trial.focusCompleted = 11;
  notReady(input, "trial.completion_counts");
});
test("sample gate applies only after provenance and data completeness", () => {
  const input = complete(); input.trial.users = 29;
  const result = supportObservation(input, now, sources);
  assert.equal(result.status, "insufficient_sample");
  assert.equal(result.ready, false);
  assert.equal(result.improvementClaim, false);
});
test("malformed outer input is not ready, never an implicit zero safety report", () => {
  for (const input of [null, undefined, [], "", 1]) notReady(input);
});

test("self-attested source metadata cannot register itself in the production source catalog", () => {
  const input = { ...complete(), qualifiedDisplaySources: sources };
  const result = supportObservation(input, now);
  assert.equal(result.status, "not_ready");
  assert.equal(result.guardrail, null);
  assert.ok(result.missing.includes("trial.noteOnly.registered_source"));
});
test("registered source query version and evidence reference must match trusted registration", () => {
  for (const key of ["sourceId", "queryVersion", "evidenceRef"] as const) {
    const input = complete(); input.trial.provenance.noteOnly[key] = "unknown-source-or-version";
    notReady(input, "trial.noteOnly.registered_source");
  }
});

test("existing strict-greater-than guardrail thresholds are preserved at the boundary", () => {
  const input = complete();
  input.guardrails = { push_opt_out_rate: 0.15, revoke_rate: 0.08, block_rate: 0.03, report_rate: 0.01, complaint_rate: 0.005 };
  assert.equal(supportObservation(input, now, sources).status, "review");
});
