import { evaluateBuddyRollout } from "../buddy-growth/buddy-governance.ts";
import type { BuddyGuardrailMetric } from "../buddy-growth/buddy-governance.ts";

const groups = ["baseline", "trial", "control"] as const;
const counts = ["users", "noteOnly", "jointCompletions", "focusStarted", "focusCompleted", "sleepStarted", "sleepCompleted"] as const;
const metrics: BuddyGuardrailMetric[] = ["push_opt_out_rate", "revoke_rate", "block_rate", "report_rate", "complaint_rate"];
const qualifications = ["recipient", "currentAuthorization", "unexpired", "foregroundVisible", "unprotected"] as const;

/** Trusted caller-owned source registration, never taken from aggregate JSON. */
export interface QualifiedSupportDisplaySource {
  id: string; queryVersion: string; evidenceRef: string;
}
// No real display aggregation source has passed qualification yet.
const qualifiedDisplaySources: readonly QualifiedSupportDisplaySource[] = [];

/** Aggregate input remains untrusted until counts, real-window evidence and source attestations pass. */
export interface SupportObservationInput {
  baseline: unknown; trial: unknown; control: unknown; guardrails: unknown;
}

/** Validates offline aggregates only; review never enables a cohort or establishes an improvement claim. */
export function supportObservation(value: unknown, now = Date.now(), sources = qualifiedDisplaySources) {
  const input = record(value) ?? {};
  const missing = [...(sources.length ? [] : ["qualified_display_source"]), ...guardrailProblems(input.guardrails),
    ...groups.flatMap(group => windowProblems(input[group], group, now, sources)), ...orderingProblems(input)];
  const common = { releaseReady: false, improvementClaim: false } as const;
  if (missing.length) return { ...common, status: "not_ready", ready: false, missing, guardrail: null };
  const guardrail = evaluateBuddyRollout(input.guardrails as Record<BuddyGuardrailMetric, number>);
  const sampled = groups.every(group => Number(record(input[group])!.users) >= 30);
  const status = !guardrail.enabled ? "stop" : sampled ? "review" : "insufficient_sample";
  return { ...common, status, ready: status === "review", missing: [], guardrail,
    baseline: summary(input.baseline), trial: summary(input.trial), control: summary(input.control) };
}
function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}
function reference(value: unknown) {
  return typeof value === "string" && value.trim().length > 0;
}
function guardrailProblems(value: unknown) {
  const rates = record(value) ?? {};
  return metrics.filter(key => {
    const rate = rates[key];
    return typeof rate !== "number" || !Number.isFinite(rate) || rate < 0 || rate > 1;
  }).map(key => `guardrails.${key}`);
}
function windowProblems(value: unknown, group: string, now: number, sources: readonly QualifiedSupportDisplaySource[]): string[] {
  const window = record(value);
  if (!window) return [`${group}.window`];
  const missing = counts.filter(key => {
    const count = window[key];
    return typeof count !== "number" || !Number.isSafeInteger(count) || count < 0;
  }).map(key => `${group}.counts.${key}`);
  const from = timestamp(window.from), to = timestamp(window.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to > now || to - from < 14 * 86400000)
    missing.push(`${group}.completed_14_days`);
  if (Number(window.focusCompleted) > Number(window.focusStarted) || Number(window.sleepCompleted) > Number(window.sleepStarted))
    missing.push(`${group}.completion_counts`);
  return [...missing, ...provenanceProblems(window, group, sources)];
}
function timestamp(value: unknown) {
  return typeof value === "string" ? Date.parse(value) : NaN;
}
function orderingProblems(input: Record<string, unknown>) {
  const baseline = record(input.baseline), trial = record(input.trial), control = record(input.control);
  const missing: string[] = [];
  if (trial && control && (timestamp(trial.from) !== timestamp(control.from) || timestamp(trial.to) !== timestamp(control.to)))
    missing.push("control.concurrent_window");
  if (baseline && trial && timestamp(baseline.to) > timestamp(trial.from)) missing.push("baseline.precedes_trial");
  return missing;
}
function provenanceProblems(window: Record<string, unknown>, group: string, sources: readonly QualifiedSupportDisplaySource[]) {
  const provenance = record(window.provenance) ?? {};
  const missing: string[] = [];
  if (provenance.dataKind !== "real") missing.push(`${group}.real_data`);
  if (!reference(provenance.evidenceRef)) missing.push(`${group}.aggregate_evidence`);
  return [...missing, ...displaySourceProblems(provenance.noteOnly, window, group, sources)];
}
function displaySourceProblems(value: unknown, window: Record<string, unknown>, group: string, sources: readonly QualifiedSupportDisplaySource[]) {
  const source = record(value) ?? {};
  const expected = { status: "qualified", source: "qualified_display_aggregate", unit: "relationship_group_week",
    deduplication: "first_qualified_display_then_relationship_group_week", from: window.from, to: window.to };
  const missing = Object.entries(expected).filter(([key, value]) => source[key] !== value).map(([key]) => `${group}.noteOnly.${key}`);
  for (const key of ["evidenceRef", "queryVersion"]) {
    if (!reference(source[key])) missing.push(`${group}.noteOnly.${key}`);
  }
  const registered = sources.find(candidate => candidate.id === source.sourceId);
  if (!registered || registered.queryVersion !== source.queryVersion || registered.evidenceRef !== source.evidenceRef)
    missing.push(`${group}.noteOnly.registered_source`);
  const qualification = record(source.qualification) ?? {};
  return [...missing, ...qualifications.filter(key => qualification[key] !== true).map(key => `${group}.noteOnly.qualification.${key}`)];
}
function summary(value: unknown) {
  const window = record(value)!;
  return { users: window.users, noteOnly: window.noteOnly, jointCompletions: window.jointCompletions,
    focusCompletionRate: window.focusStarted ? Number(window.focusCompleted) / Number(window.focusStarted) : null,
    sleepCompletionRate: window.sleepStarted ? Number(window.sleepCompleted) / Number(window.sleepStarted) : null };
}
