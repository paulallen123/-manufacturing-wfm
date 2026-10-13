# Private proof harness builder admission — issue #185

Status: **TESTED** as an isolated release-control package. No canonical integration or hosted proof claim.

## Requirement and source

Issue [#185](https://github.com/paulallen123/-manufacturing-wfm/issues/185) records a private five-role proof harness whose Railway service was configured for a Dockerfile but whose deployments entered Railpack and failed before application proof. The current issue remains open. This package classifies that exact mismatch and prevents its receipt from being treated as application evidence when the classifier is invoked with current service build configuration and deployment logs.

## Owner and conflict check

At selection on 2026-10-13, #185 had no assignee or matching open PR. GitHub branch search for `private-browser-proof` and `dockerfile-path` returned no branches. The existing private harness source branch `development/private-proof-harness-20260919-1308` last committed on 2026-09-20 and is historical proof infrastructure; this work does not modify it. The live candidate Railway service has a separate staged source SHA change owned by the release lane, so no Railway mutation was made.

## Exact source and observed failure

- Package base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, `release/vector-customer-ready-candidate-20260925`.
- Private harness source branch observed at `8230879af79b7d13cf6edc37d586bf69d263ee36`. That tree contains `Dockerfile.current-candidate-role-browser-proof`.
- Railway project `9a774359-37fa-47e8-bde0-932420c32923`, environment `6a33f2c1-bedd-46dc-85e7-2ef5d3b54de6`, service `e59a4730-bdfe-47ca-8fe1-46aa1240fc6d`: builder `DOCKERFILE`, path `Dockerfile.current-candidate-role-browser-proof`, no public domain, no staged changes.
- Its latest observed deployment `13fd2993-bb47-4cae-90d3-f693e04cb18e` is `FAILED`. Build log contains `using build driver railpack-v0.40.0`, `[railway] prepare railpack-v0.40.0`, and `Railpack could not determine how to build the app`. No Docker or browser proof step ran.

## Changed files and result

- `scripts/classify-proof-blocker.mjs`: classifies a Dockerfile/Railpack conflict only when the build configuration, deployment metadata, and log are bound to the same deployment ID, source SHA and snapshot ID. Its existing result quarantines affected promotion while unrelated development continues. The optional `--deployment-context <file> --enforce` CLI exits 2 for every blocking classification.
- `scripts/validate-proof-blocker-classifier.mjs`: regression covers deployment binding, nested Dockerfile paths, CLI exit, and fail-closed behavior when bound context is missing.
- `release/development-proof-control.json`: declares the new blocker class.
- `release/proof-blocker-knowledge.json` and `scripts/validate-development-proof-readiness.mjs`: retain the issue as a learned blocker with a permanent guard check.

The classifier distinguishes evidence about the provider build path from a product test failure. It does not claim to repair Railway's effective builder selection. No secret values or customer data were read or written.

## Tests and gates

- Red first: `node scripts/validate-proof-blocker-classifier.mjs` failed because `UNKNOWN_FAIL_CLOSED` was returned instead of `PROVIDER_BUILD_PATH_MISMATCH`.
- Independent review identified four defects in the first revision: enforcement exit code, deployment/config binding, missing declared blocker class, and nested Dockerfile paths. All four were repaired with regressions. The first revision's green test results do not count as final evidence.
- Green on local Node v24.19.0 after repair: classifier validator passed; development proof preflight passed (`files=379`, `localRefs=17`, `learnedGuards=27`); `git diff --check` passed.
- Green on pinned Node v22.23.2 Docker image digest `sha256:4d676821dff059fd00d277ee4261ef34ea712317fed0737c03941481b5760c96` after repair: classifier validator and development proof preflight passed; `git diff --check` passed.

## Review, integration, deployment and next action

Independent review: **completed on first revision; final repair review pending**. Canonical integration: **pending**. Package deployment: **none**. Private harness and customer proof: **not proven**. The currently available Railway service configuration and historical deployment log are not an independently bound deployment snapshot, so this historical incident remains a suspected builder conflict. The classifier needs a deployment-bound build configuration, source SHA, snapshot ID and build log; missing binding remains `UNKNOWN_FAIL_CLOSED` and exits 2 under `--enforce`.

The canonical owner should review this six-file package, reconcile it with the current candidate head, and admit it through the release controls. For #185 itself, the owner or Railway must obtain deployment-bound configuration evidence, resolve why Railpack appeared despite the Dockerfile configuration if confirmed, then run a fresh exact-SHA private proof build and the five-role hosted proof. Until then this lane remains blocked and must not count as customer proof.
