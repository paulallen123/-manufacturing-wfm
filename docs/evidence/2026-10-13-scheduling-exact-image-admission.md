# PR352 exact scheduling source and image admission

## Requirement and source

F2.1 requires the accepted advanced-manufacturing scheduler to retain skills,
availability, rest, policy, cost, fairness and disruption constraints on the
exact selected release artifact. PR352 implements the reviewed cross-site
transfer, immutable availability and explicit overtime-authority slice. Its
latest repaired head is `71bd4dab2acd5557a965ef238d6bde402384f04d`.

## Owner and conflict check

The canonical release branch remains
`48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. PR352 owns exactly
`operations/runtime/manufacturing-scheduling-engine.cjs` and its existing test.
Its exact head has terminal CircleCI `forge_core_validation` success (build
807), no GitHub Actions run, and no separate exact-image admission branch or
PR. This proof package does not edit either owned scheduler file, any product
route, runner, controller, Dockerfile, deployment or tenant state. The sole
canonical integrator remains `Continue customer proof`.

## Exact base and changed files

- Base commit: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`
- Base tree: `cc8ff3737036dec8fe69a90e0759289661280537`
- Target under test: `71bd4dab2acd5557a965ef238d6bde402384f04d`
- Added `.github/workflows/scheduling-exact-image-admission.yml`
- Added `docs/evidence/2026-10-13-scheduling-exact-image-admission.md`

## Admission design

The workflow checks out the immutable PR352 target rather than the proof branch,
binds `HEAD` and Node `v22.23.2`, runs the scheduler plus its five affected
consumer suites, then invokes the repository's unchanged full Docker admission
with the same target SHA. The final-image check requires the image build-source
identity and byte-for-byte installation of the reviewed scheduling engine. A
successful build without the selected engine in the final serving image is a
failure, not a pass.

## Evidence state before execution

- Source syntax and 97/97 focused tests: author-reported on Node v24.19.0.
- Independent source review: READY at exact head, with held-out tamper cases.
- CircleCI 807: terminal SUCCESS for exact head.
- Supported Node 22.23.2 affected suite: pending this workflow.
- Unchanged complete Docker admission: pending this workflow.
- Final serving-image scheduler byte identity: pending this workflow.
- Canonical integration, deployment, hosted proof and customer proof: not
  attempted by this package.

## Risks and next action

The target is based on historical `90ad90fc...`, not the current canonical
union, so even a green result remains isolated evidence. The canonical owner
must reconcile the reviewed scheduler with PR320/341/346/353/356 and the
current `48dce8f...` source, rerun combined native/image gates, deploy once
through approved controls, and prove the authenticated manager journey,
persisted readback, downstream consequence and audit on one serving SHA.
