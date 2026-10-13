# Independent review: planned break declared coverage adjunct

Reviewed 2026-10-13. **Approved for canonical owner review/adoption at the exact final identities below. No unresolved blocking findings.** Continue customer proof remains the sole integrator and release owner; existing scheduler/forecast owners retain the manufacturing engine. This is synthetic local evidence for a pure advisory adjunct, not customer proof, scheduling parity or assignment clearance.

## Scope and exact identities

Read the new source/test, canonical reused manufacturing scheduler source/test, scoped workflow and supplied evidence document. Requested upstream base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. This is a partial local package, not verification of that complete commit tree.

Independently verified unchanged reused engine Git blobs with `git hash-object`:

| Reused canonical file | Git blob |
| --- | --- |
| `operations/runtime/manufacturing-scheduling-engine.cjs` | `97cbbc3405abfc010a6513aa67ab58d56e1079f8` |
| `operations/runtime/manufacturing-scheduling-engine.test.cjs` | `ee1c0b4e12d818b67e03bdf0dd6ae53624cdc2b8` |

| Final reviewed new file | SHA256 |
| --- | --- |
| `operations/runtime/planned-break-coverage.cjs` | `58cc516328ecc7947b8c5c17eebc6eca738738ea0eed2a5329bd0bde6cbc1d14` |
| `operations/runtime/planned-break-coverage.test.cjs` | `c7d687387aebfee383cb6c76cc2bb9bfa4909f04bee9f47b0db4e77118d083c2` |
| `.github/workflows/planned-break-coverage-gate.yml` | `5fd60d0f3089f20993d6b6fe891c4242a44474f6aad44eb8d4feacb6e8779d54` |

I made no implementation, test-suite or workflow edits. Only this report and `/workspace/scratch/11d7df70bc11/planned-break-coverage-review-probes.cjs` were written, outside the package. No external posting, hosted jobs, provider actions, Docker build or deployment was initiated.

## Findings by severity

**Critical: none. Important: two resolved admission-consistency findings. Remaining important/minor actionable defects: none found.**

1. **Important, resolved — assignment scope could contradict the requirement after rehashing.** Initial source `69f94a425626e16cf279c54d32f76d936fbbd72c8ad5e3bfa105e7f29d14b810` checked assignment times and slot identity but ignored assignment site/role/line. A contradictory site could be counted as declared coverage of the requirement's site despite a matching digest. The integrator independently reproduced the site case as a failing primary regression (reported 11 pass/1 fail). Related incomplete canonical records lacked enforced sourceEvidence and valid/empty-violation validation fields. Final admission requires populated source references, validation.valid true with no violations, a requirement role, and matching assignment site/role/line for filled and unfilled slots. My independent probes pass for wrong site, wrong role/line, missing role/sourceEvidence, validation.valid false and nonempty violations, all with recomputed matching digests. These checks establish structural consistency, not source authentication.

2. **Important, resolved — a worker-present assignment could also declare shortfall true.** My actual interim independent run returned `DECLARED_COVERAGE_COMPLETE_UNVERIFIED` for a rehashed assignment containing both `workerId: 'worker0'` and `shortfall: true`, rather than rejection: probe command exit 1, 14 pass/1 fail. Final source rejects that contradiction and checks shortfall-slot site/role/line unconditionally. Final independent run passes these cases. Canonical scheduler-produced null-worker shortfalls remain valid inputs and produce full-period gaps.

The final primary contradiction test now includes both worker-present/shortfall-true and null-worker shortfall/wrong-site mutations. After that test-only addition I independently reran the combined suite (40/40), independent probes (15/15), syntax checks and exact hashes.

The first independent 13-probe run occurred while the integrator had already installed the first fixes; it passed 13/13. It must not be represented as an independently observed pre-fix RED result for the site finding. The separate 14/15 contradiction RED above was observed directly by this reviewer.

## Final correctness and limits

The adjunct validates a plain-data snapshot before consulting input fields, denies getters/proxies/revoked proxies/custom iteration/serializers/cycles without invoking supplied behavior, and returns detached deeply frozen ordinary objects. All outcomes retain executionPermitted false and customerReady false.

Receipts bind exact tenant/context revision/plan identity/worker/slot/site, with nonempty source reference and revision and valid explicit UTC intervals contained in the assigned slot. Exact worker+reference replay is idempotent; altered content or revision conflicts reject. Digest consistency remains separate from owner authentication/current-source verification.

Distinct worker identities determine available staffing. Complete declared slot identities/counts are required. Concurrent double assignment rejects globally. Half-open break edges correctly produce available counts 1/0/1 for two overlapping worker breaks; touching breaks retain one worker on each side. Multiple overlapping receipts for the same worker remove that worker once. Existing assignment shortfalls persist through the entire requirement, and worker breaks increase them. Adjacent shifts are accepted; a one-millisecond overlap rejects. Receipt order does not alter output. Empty breaks explicitly declare none; missing breaks produce INCOMPLETE. Zero demand can be declared complete without authority.

The result is useful for locating declared staffing gaps, not selecting or proving relief workers. It does not validate actual attendance, skill truth, entitlement/pay, rest/fatigue legality, relief eligibility, source freshness/authentication, worker routes or publication authority. It does not rerun all scheduler optimisation/quality calculations. Standard runtime built-ins are assumed trustworthy; this is input-object admission, not protection against an already-compromised process. No current legal-policy claim is made.

## Actual commands and results

Runtime `node --version`: `v24.19.0`. Commands ran from `/workspace/scratch/11d7df70bc11/break-coverage` unless stated.

| Command/check | Actual result |
| --- | --- |
| Initial `node --test operations/runtime/planned-break-coverage.test.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs` | Exit 0; 38/38 (new 11 + existing 27), before review fixes |
| Interim `node --test /workspace/scratch/11d7df70bc11/planned-break-coverage-review-probes.cjs` | Exit 1; 14/15; worker-present/shortfall contradiction failed as described |
| Final same independent probe command | Exit 0; 15/15; no failures/skips |
| Final `node --test operations/runtime/planned-break-coverage.test.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs` | Exit 0; 40/40 (new 13 + unchanged existing 27), no failures/skips/cancellations/todos |
| `node --check operations/runtime/planned-break-coverage.cjs && node --check operations/runtime/planned-break-coverage.test.cjs` | Exit 0 |
| `git hash-object operations/runtime/manufacturing-scheduling-engine.cjs operations/runtime/manufacturing-scheduling-engine.test.cjs` | Exact unchanged canonical identities shown above |
| `sha256sum operations/runtime/planned-break-coverage.cjs operations/runtime/planned-break-coverage.test.cjs .github/workflows/planned-break-coverage-gate.yml` | Exact final reviewed identities shown above |

The independent probe file contains 15 groups covering multiworker overlapping and adjacent breaks, same-worker receipt union, genuine scheduler shortfalls, full-slot breaks/zero demand, shift adjacency, malformed collections and slot declarations, active data/revoked proxies, JSON roundtrip/recursive null prototypes/immutable public output, receipt replay/revision conflict, and all corrected admission inconsistencies. Counts are separate runs; the 40-case combined suite already includes its 13 new adjunct cases.

## Workflow and approval boundary

The new workflow statically uses the supplied existing pinned checkout/setup-node identities, Node22.23.2, disabled package-manager cache and read-only contents permission. It runs only the adjunct and unchanged scheduler tests plus syntax checks, with a five-minute timeout and release-branch/path-filter scope. It has no deploy or publishing step. No hosted execution was started, and Node22 results are not certified by these Node24 runs.

Approval covers only the exact new source/test bytes and static workflow configuration above for owner adoption. It does not certify full-tree/native-image integration, a serving runtime/API, hosted test success, deployment, current legal policy, source truth, customer value or customer acceptance. The evidence document's operational/live-service assertions were not independently investigated by this review. Owner-authenticated planned-break integration, authorised relief planning and persisted plan/audit proof on a serving SHA remain outside this bounded package.
