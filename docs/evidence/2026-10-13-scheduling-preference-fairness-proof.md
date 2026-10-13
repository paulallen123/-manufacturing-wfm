# Scheduling preference and fairness proof slice — 2026-10-13

## Requirement and owner check

Issue #202's employee-management target requires worker preferences and fair allocation. The canonical scheduling engine already accepts preference and historical fairness signals, but its current tests did not assert the ranking effect or explainability. This package tests the existing advisory behavior for preferred/avoided sites, lines, and tags, plus historical overtime and undesirable-shift counts. It also requires a missing qualification to outrank any preference advantage.

The sole canonical implementation/integration owner retains adoption and release authority. Before selection, open PR and remote branch searches found no focused preference/fairness proof package. PR #352 changes the scheduler source and existing test; this package changes neither and starts no scheduler, writer, runner, route, or deployment. PR #357 changes forecast/service files and is also left intact. Broad FORGE PR #225 remains the canonical experience context, not a claim that this focused test is already admitted.

## Exact package and result

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2` on `release/vector-customer-ready-candidate-20260925`. Changed files: `operations/runtime/scheduling-preference-fairness-proof.test.cjs`, `.github/workflows/scheduling-preference-proof-gate.yml`, and this record.

The new synthetic regression calls the existing `evaluateOpenShift` and `createSchedulingPlan` APIs. It checks ranked output, exposed preference/fairness penalties, hard qualification priority, plan explanation and `executionPermitted=false`. The CI workflow pins Node 22.23.2 and runs the focused and existing scheduler suites on the exact PR head. It does not change product ranking logic or grant authority.

## Test and lifecycle evidence

- Local `node --test operations/runtime/scheduling-preference-fairness-proof.test.cjs`: 4/4 passed, zero failures.
- Pinned Node 22.23.2 Docker image, focused plus existing scheduler suite: 31/31 passed, zero failures.
- Independent review: 31/31 local rerun passed; reviewer found the workflow path filter omitted future engine/test edits. The filter was expanded and reviewer confirmed no remaining blocker in this bounded package.
- CI workflow: added, not yet observed executing on GitHub. GitHub runner acquisition has a separate active issue and cannot be assumed green.
- Canonical integration, exact-candidate deployment, hosted role/customer proof: pending.

**Status: TESTED locally.** The package proves deterministic synthetic ranking only. It does not establish authoritative preference capture, fairness policy adequacy, complete weekend/fatigue treatment, actual schedule publication, customer acceptance, or the Golden Journey. The candidate Railway service still serves an older SHA while the exact candidate source change is staged.

## Next action

Canonical owner independently reviews this small regression, reconciles it with PR #357/#352 and the complete scheduling policy, adopts it into the one candidate, runs combined exact-image gates, then verifies an authenticated synthetic manager journey with authoritative worker preference evidence and persisted plan/audit readback before upgrading the claim.
