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
first fails unless the actor is the repository owner, binds `HEAD` and Node
`v22.23.2`, runs the scheduler plus its five affected consumer suites, then
invokes the repository's unchanged full Docker admission with the same target
SHA. The final-image check runs without network, write access or Linux
capabilities; it requires the image build-source identity, a non-symlinked
byte-for-byte installation of the reviewed scheduling engine, and a synthetic
no-mutation plan through the installed `/app` engine. A successful build
without those exact named jobs succeeding is a failure, not a pass; an
`always()` verdict job explicitly rejects every skipped or failed prerequisite.

## Execution evidence

- Source syntax and 97/97 focused tests: author-reported on Node v24.19.0.
- Independent source review: READY at exact head, with held-out tamper cases.
- CircleCI 807: terminal SUCCESS for exact head.
- GitHub Actions run 38440811045, job 115446581978: exact target checkout,
  Node v22.23.2 binding and scheduler blob binding passed. The consumer suite
  ran 196 tests: 192 passed and 4 failed. The installed-image job was skipped
  because it correctly depends on source admission.
- One failure was a proof prerequisite omission: the composed bootstrap refused
  to start because `security/runtime` dependencies were not installed. The
  workflow now runs the repository-prescribed `npm ci --prefix
  security/runtime --ignore-scripts` before the suite.
- Independent review found a critical false-pass path in the first workflow:
  job-level owner conditions could mark both skipped jobs successful. Those
  conditions are replaced by a mandatory failing `ownership-guard` dependency.
  The image verifier is also read-only and networkless and now exercises the
  installed engine rather than proving bytes alone.
- Corrected run 38441123234, job 115447661250: dependency installation passed;
  206 tests ran, 203 passed and 3 failed with zero skip/cancel. The sole
  remaining failures are the two authority-projection variants and stored
  no-show repair. Image job 115447891050 correctly skipped.
- Those three failures are a deterministic product-integration blocker. Stored plans
  are bound with `authorityScope` after `planId` is calculated, while PR352's
  new `verifiedPriorPlan` recalculates identity across that appended field.
  Consequently `/repair/shadow` returns 400; both authority-projection variants
  then dereference an absent `repair.repairedPlan` and fail. No unchanged rerun
  was performed.
- Hardened run 38441294264 completed FAILURE as designed: ownership guard
  succeeded; source job 115448308283 again ran 206 tests (203 pass, 3 fail,
  zero skip/cancel); the exact-image job skipped; and final verdict job
  115448510329 failed because not every named admission job succeeded.
- Unchanged complete Docker admission and final image byte identity: blocked
  until source admission passes.
- Canonical integration, deployment, hosted proof and customer proof: not
  attempted by this package.

## Risks and next action

The target is based on historical `90ad90fc...`, not the current canonical
union, so even a green result remains isolated evidence. The PR352 owner must
first reconcile prior-plan identity with the service-owned `authorityScope`
binding without weakening tamper detection, then rerun this exact gate. The
canonical owner must reconcile the reviewed scheduler with PR320/341/346/353/356
and the current `48dce8f...` source, rerun combined native/image gates, deploy
once through approved controls, and prove the authenticated manager journey,
persisted readback, downstream consequence and audit on one serving SHA.
