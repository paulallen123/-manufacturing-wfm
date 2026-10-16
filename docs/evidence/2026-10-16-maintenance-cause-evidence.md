# Source-recorded maintenance cause evidence, 2026-10-16

## Requirement and source

Issue #202 includes maintenance reliability metrics and root-cause evidence. Open PR #421 provides a source-owned failure window with `rootCauseCode` and `rootCauseEvidenceRef` fields, but explicitly excludes cause inference. This bounded check requires a separate CMMS cause record to bind those fields to the exact failure event revision and record hash. It reports only a source-recorded code or unknown state, never causal proof, cost, savings or action authority.

## Ownership and conflict

The sole canonical integration and release owner remains responsible for adoption. On 2026-10-16, open PR title/body searches for maintenance cause evidence, CMMS cause, downtime cause, root-cause evidence references and failure cause found no focused cause-record validator. Remote searches found no maintenance-cause or root-cause branch. PR #421's module aggregates failures and explicitly leaves cause validation/inference out; this package changes no #421 file. Other maintenance PRs #394/#415/#430/#449/#477 own separate requirements. This run started no shared writer, runner, controller or deployment.

## Exact base and files

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, the staged release source, not a serving SHA. Isolated branch `feature/maintenance-cause-evidence-20261016` changes only `operations/runtime/maintenance-cause-evidence.cjs`, its focused `.test.cjs` and this evidence record.

## Implementation and actual checks

The pure function accepts the existing reliability result shape. It requires current exact evaluation time, source snapshot age, one exact failure event, and a scoped CMMS cause record whose source, event ID, event revision/hash, cause code/reference and observation interval agree. A missing source-declared cause stays `UNKNOWN`; incomplete or contradictory records are `BLOCKED`. Its `SOURCE_RECORDED` result marks `causalStatus: UNVERIFIED`, `executionAuthority: false`, `sourceAuthenticated: false` and `currentRevisionVerified: false`. Source references, hashes, status and caller time are still assertions until an authenticated adapter verifies them and reads the current CMMS revision, including later withdrawals.

TDD stub run: 1/3 passed, two intended behavior assertions failed. Initial implemented focused suite: 3/3 passed on Node v24.19.0. Independent review confirmed the PR #421 result contract but found two false rejections: a separate cause record observed after the failure-window snapshot and a diagnosis recorded during the failure. New cases failed 3/5 before correction, then passed 5/5. The reviewer also found the missing current-revision guarantee; that remains a trusted-adapter integration blocker and is explicit in the result.

After installing the declared local passkey test dependency with `npm ci --prefix security/runtime --ignore-scripts`, the first `node --test operations/runtime/*.test.cjs` run passed 376/376. The final corrected operations suite passed 378/378 on Node v24.19.0. Source and test syntax checks and diff check passed. `node scripts/validate-deployment.mjs` passed artifact-integrity validation and confirmed `productionApproved:false` / `stagingOnly:true`. Independent re-review found no remaining Important/Medium code defect in this isolated contract. No pinned Node 22, Docker, hosted, CMMS or customer test ran.

## Release state and next action

The customer-ready Railway service is currently offline with no active deployment. Historical deployment `faca24a2-10b9-4289-bc49-3406e44f7272`, serving source `90ad90fcf60adaca9abacdd4ad14bf392f95e585`, became `REMOVED` at 2026-10-16T06:29:27Z. Source `48dce8f` remains staged in patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8`. The sealed artifact remains production-unapproved and staging-only. No tenant or Railway mutation occurred.

The canonical owner should independently review this package, reconcile it with #421 in one candidate, authenticate CMMS cause records and server time, then run exact-image/security gates and synthetic hosted failure/cause readback after the existing release process restores an eligible tenant. Until then this is neither integrated nor deployed nor customer-proven.
