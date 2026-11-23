# FrogSleep support observation input and readiness

Updated: 2026-10-25. This offline CLI validates aggregates, not client views or public API requests. It does not collect browsing, upload read events, enable cohorts, or claim improvement.

```sh
node --experimental-transform-types scripts/frogsleep-support-observation.ts docs/frogsleep-support-observation-input.example.json
```

The checked-in example intentionally has no real observation data. Expect JSON `status: "not_ready"`, `ready: false`, `guardrail: null`, exit **2**. Missing data is never a zero measurement. Older inputs containing only counts and rates are no longer sufficient for review.

## Result contract

| Status | Meaning | Exit |
|---|---|---|
| `not_ready` | Missing/invalid guardrails, real data, completed windows, counts, or qualified display provenance; `missing` lists field-level reasons | 2 |
| `insufficient_sample` | All input/source checks passed but one of baseline/trial/control has fewer than 30 users | 2 |
| `stop` | Complete input/source checks passed and existing guardrail thresholds are breached | 3 |
| `review` | Input/source checks and minimum sample passed; requires human evidence review, not release | 0 |

Every result has `releaseReady: false` and `improvementClaim: false`. `ready` describes the input-validation stage only. `not_ready` returns no safety decision (`guardrail: null`); it must not be interpreted as safe or enabled. A known partial high rate does not make the remaining guardrails measured.

## Required windows and real data

`baseline`, `trial`, and `control` each contain:

- `from`/`to`: valid completed timestamps at least 14 days apart, ending no later than evaluation time. Baseline ends before or at trial start; trial and control cover the same instants.
- `users`, `noteOnly`, `jointCompletions`, `focusStarted`, `focusCompleted`, `sleepStarted`, `sleepCompleted`: explicit nonnegative safe integers. Completed counts cannot exceed their started counts. Missing/null/string/fractional values are not coerced.
- `provenance.dataKind`: exactly `real`. `qa`, `synthetic`, absent or other kinds are not real 14-day data.
- `provenance.evidenceRef`: nonblank offline reference to the independently reviewed aggregate-generation evidence, including version, window, eligibility, denominators and generation method. Do not include raw identifiers, credentials or note content.
- `provenance.noteOnly`: the qualified display source declaration below, required even when `noteOnly` is zero. Uncollected is not a measured zero.

The code validates declarations and their consistency; it cannot prove that an operator's claim of real data is honest. Human review must verify underlying references, cohort membership/withdrawals, all guardrail numerators and denominators, and real observation coverage. Do not populate synthetic evidence as real to satisfy the validator.

## Required `noteOnly` source

| Field under `provenance.noteOnly` | Required value |
|---|---|
| `status` | `qualified` |
| `source` | `qualified_display_aggregate` |
| `sourceId` | An independently registered trusted source ID |
| `queryVersion`, `evidenceRef` | Nonblank, exactly matching the trusted registration |
| `unit` | `relationship_group_week` |
| `deduplication` | `first_qualified_display_then_relationship_group_week` |
| `from`, `to` | Exactly the enclosing window's timestamps |
| `qualification.recipient` | `true`: actual recipient qualification |
| `qualification.currentAuthorization` | `true`: authorization valid at display |
| `qualification.unexpired` | `true`: expired placeholders excluded |
| `qualification.foregroundVisible` | `true`: actual foreground visible content, not lifecycle callbacks |
| `qualification.unprotected` | `true`: personal protected activity excluded |

The trusted source catalog is currently **empty**, because no real display aggregate source has been qualified. The CLI does not accept registrations from input JSON, flags, or environment variables. Even fully self-attested metadata cannot make it return `review`. Tests inject hypothetical registrations into the pure function only to exercise future eligible branches; these are not shipped sources or real data.

Registering a future source requires an independently reviewed aggregation/qualification design and versioned evidence. The count is first qualified recipient/relationship/note display, then deduplicated by relationship group and observation week, including same-person dual-domain rules. Reopening the same note does not create a new first display. `noteOnly` excludes groups with a qualifying joint action in the same week; its evidence must establish that partition and unit, not count messages or users. Any change to measurement or permitted collection needs its own reviewed scope before implementation.

Server acceptance, acknowledgement, GET/page-open counts and current local lifecycle view markers are **not** qualified sources. There is no new view event, export, cross-device view merge, or sender-visible read receipt in this fix.

## Required guardrails

All five fields under `guardrails` must be explicit finite numbers in `[0, 1]`: `push_opt_out_rate`, `revoke_rate`, `block_rate`, `report_rate`, `complaint_rate`. Empty objects, missing keys, null, strings, NaN, infinity and out-of-range values return `not_ready`; they never reach `evaluateBuddyRollout` with missing values. Explicit measured zero is allowed only when independently evidenced.

This wrapper preserves the shared governance evaluator and its existing strict-greater-than source defaults (0.15/0.08/0.03/0.01/0.005). It does not change other callers, establish deployed thresholds, or certify the source of rates. Effective environment configuration and denominators still need human verification. No Push exposure is not automatically a measured push opt-out rate of zero; resolve eligibility and scope formally rather than filling zero.

## Verification and limits

Run the targeted suite:

```sh
node --experimental-transform-types --test test/unit/frogsleep-support-observation.test.ts test/unit/frogsleep-support-observation-cli.test.ts test/unit/frogsleep-buddy-governance.test.ts
```

Unit fixtures are hypothetical contract inputs. CLI tests use temporary synthetic files and the intentionally empty checked-in example. Passing tests do not prove real display or 14-day observation. OpenSpec 8.3 remains incomplete until actual qualified sources, real completed data, sample and governance evidence are available.
