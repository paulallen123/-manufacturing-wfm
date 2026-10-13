# F2.4 exact paired agency consumer admission

Harness status: **TESTED**, independently reviewed. Defensive adapter acceptance: **IN PROGRESS / FAILED synthetic consumer gate**. Product repair, canonical integration, deployment and hosted/customer proof: **not established**.

## Requirement, source and owner/conflict check

Accepted F2.4 agency worker identity and safe work-start evidence; current Friday release backlog, intake, #265/#288 and PR455/457 require paired semantic reconciliation instead of treating separate source/Docker receipts as one combined customer outcome. Reservation #265comment6155505912.

Fresh visible checks: canonical ref, full current open PR list, matching branch refs, recent #265/#288 owner receipts and active Actions (none found). Both PR455/457 had no reviews/requested reviewers/comments at selection; existing documents claim scoped reviews but no separate joint-consumer receipt. No visible gate owner/branch/job was found. Hidden chats/leases cannot be certified. Existing source authors retain all source/test files. Continue customer proof remains sole canonical integrator/release owner; no source repair, canonical merge, controller, deployment or shared runner takeover.

## Exact sources and changed files

- Canonical base48dce8f697825c8cd5f99b3e5aeea3953647f8c2; treecc8ff3737036dec8fe69a90e0759289661280537.
- PR455 immutable head1396eb5123cbfd7a5b5dc82c95b3cd86e8531072: work-start source397d676319d56393d2b62a8ce8fdc2d73ef0aa87; testca9e82abba0be31e6010340096fa5aa713ed6155.
- PR457 immutable head8534ffd507d1e1cf3027aa7853ae53115e46deef: continuity source1d29f27d3d47babf6e97ba3b3dac1593ea68bb79; test7a899f99564af45fd9dda237d4f1b5fba2e35556.
- Four fetched files independently verified by git hash-object. Read-only GitHub comparisons establish each package ahead1/behind0 over48d with disjoint file changes. This is an isolated overlay, not canonical adoption.
- Changed/added only `test/frontier/agency-work-start-combined-consumer.test.mjs`, `scripts/prepare-agency-consumer-fixture.py`, `.github/workflows/agency-combined-consumer-admission.yml`, this note and independent review report. No existing engine or original test is changed.

## Implemented gate

The new test uses both real PostgreSQL reader adapters and the actual imported continuity evaluator; there is no injected evaluateContinuity success. Query results are synthetic in-memory fixtures, not a real PostgreSQL connection. Positive controls require actual continuity evaluation plus two authority reads and retained no-write/ranking boundaries. Negative controls cover expired coverage, PR455 overlength authority and PR457 overlength observations.

The loader fetches only four fixed repository paths at the exact immutable commits, verifies declared Git blobs independently against bytes and prepares a new temporary fixture; it never overwrites repository engines. CI uses existing pinned actions, Node22.23.2, read-only repository token, separate baseline/consumer steps, no suppression of failing cases and no deploy/image/publication step. `--existing` performs local byte verification without networking.

## Actual tests and retained failures

- Original paired suites: **20/20**, Node24.19.0 exit0, zero failures/skips.
- Initial new consumer run: **6/8**, exit1; blank/unparseable expiry failed conservative expectations. The initial impossible-date example was already expired after rollover and therefore denied; it was replaced with a future impossible date to isolate calendar validation.
- Final new consumer suite: **5/8**, exit1; `coverageUntil:'not-an-instant'`, `''` and `'2027-02-30T12:00:00.000Z'` all produce workStartReady:true despite conservative expected denial. All three failures remain unsuppressed. Existing25passes/new3failures in a28-case combined run must not be described as a pass.
- Invalid blank/unparseable expiry is converted to null, matching the explicitly unrestricted null control. The impossible future date is rolled to2027-03-02 and remains finite; it does not become null.
- Node syntax and loader `--existing` byte verification pass. Independent review reran original20/20 and consumer5/8, tested byte mismatch rejection and legitimate finite/null/expired/native-Date/SQL-field controls, and approved the exact proof harness/workflow scope.
- Supported Node22/live loader/CI execution remains a separate gate; no local full image, PostgreSQL instance, provider or hosted application test occurred.

## Finding qualification and review status

The malformed-expiry behavior is inherited from canonical work-start source blobb8f1d640c2c81801c941a77609ed8fa51c438d1d and was not introduced by455/457. Narrow overlength repairs remain independently scoped; these new cases do not justify claiming their specific changes caused a regression.

PostgreSQL timestamptz fields do not normally return impossible or unparseable strings. These fixtures prove a permissive callback/adapter normalization boundary, **not reachability through authoritative typed database storage, a production exploit or an authenticated customer failure**. The owner must determine the actual SQL schema/type parser/producer contract and decide whether fail-closed defensive handling is required. The conservative new assertions are a proposed defensive adapter acceptance contract; they are not a proof that the historical legal/producer contract was already agreed.

The independent report preserves this qualification and separates source safety from harness approval. Synthetic true readiness still grants no work-start/schedule/clocking/payroll writes; all four write flags remain false and queries are SELECT-only.

## Integration, deployment, risks and next action

Neither source package is merged by this task. Current canonical remains48d; fresh Railway receipt still serves90ad90fcf60adaca9abacdd4ad14bf392f95e585 at deploymentfaca24a2-10b9-4289-bc49-3406e44f7272. No provider/personnel/payroll/customer/real database or shared runtime writes occurred. No product worker/background execution is claimed.

Existing agency source owner reviews the exact raw-expiry/type/producer contract. If defensive handling is accepted, preserve explicit valid indefinite null while rejecting malformed supplied expiry before normalization, add owner-side regressions, and resubmit exact source/test heads for this joint gate. If typed storage excludes the cases, retain the counterexamples as out-of-contract defense-in-depth findings and provide source/type/producer evidence before changing the admission contract. Sole integrator then reconciles both packages on one candidate, runs affected source/native/image/runtime gates and approved hosted source→continuity→work-start→fresh readback/audit proof. The new workflow's expected failure is not to be bypassed, relabelled as successful or used as product/customer proof.
