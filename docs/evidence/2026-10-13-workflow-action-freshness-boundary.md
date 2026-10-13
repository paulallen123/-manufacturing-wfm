# Workflow action freshness consistency — isolated package

## Requirement and ownership

- Backlog F2.2 manager action queue and F5.6 post-implementation evidence enforcement: a source-labelled current action must have a validity boundary after its own observation. This is a consistency check of supplied evidence, not a wall-clock freshness policy.
- Canonical release/integration owner remains Continue customer proof. Open PRs and 13 October issue handoffs were inspected; no current package was found for this exact temporal contract in `operations/runtime/workflow-action-evidence-contract.cjs`. Historical manager queue PR #80 is a wider experiment and supplies no current patch to this validator.
- Exact base `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, tree `cc8ff3737036dec8fe69a90e0759289661280537`.

## Result and changed files

- `operations/runtime/workflow-action-evidence-contract.cjs`: reject `current` when a supplied `validUntil` is at or before `observedAt`. No source-derived state or SLA is invented.
- `operations/runtime/workflow-action-evidence-contract.test.cjs`: fail-first earlier/equal expiry and positive existing current evidence.
- `.github/workflows/workflow-action-freshness-gate.yml`: supported Node22.23.2 affected suite, syntax and Docker candidate build.

## Executed evidence

- Local Node v24.19.0 baseline: 27 pass / 1 fail / 1 skip; the new test showed an earlier validity boundary was accepted.
- After repair: 28 pass / 0 fail / 1 skip on the same command. The skipped sealed-producer integration test requires the canonical archived runtime absent from this partial source checkout; it is not called passing. Both changed JavaScript syntax checks pass.
- Independent review and PR-head CI are separate gates. Local tests do not establish full canonical build, actual manager action, deployment or customer proof.

## Admission boundary

Status **TESTED locally with one retained skip**. The sole integration owner should inspect the exact diff and source-owned freshness contract, run the supported Node22 and full Docker gate with the sealed archive, integrate into the one canonical candidate, then verify the real manager action queue and fresh-session readback on that exact serving image. No tenant mutation or deployment is part of this package.
