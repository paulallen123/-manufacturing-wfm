# F2.2 Time Review action-queue envelope freshness

Requirement: F2.2 universal manager action queue and F1.10 source/role evidence integrity, authoritative Friday backlog and issue #265. Stale or future evidence must not be labelled available/current. This is a repair to the existing queue, not a new feature or proof controller.

Ownership: refreshed canonical ref, open PR inventory, focused queue/calendar/module searches, queue/freshness branches and latest #265/#288 records found no current narrow envelope-freshness claimant. Historical PR80 predecessor lineage and broad PR225 are preserved. PR387 owns a different server contract expiry guard. Reservation: https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6150658294. Continue customer proof retains sole canonical integration/release ownership. Visible jobs were unrelated policy jobs; no queue runner was started. Off-platform ownership is not comprehensively visible.

Exact base: release/vector-customer-ready-candidate-20260925 at 48dce8f697825c8cd5f99b3e5aeea3953647f8c2, tree cc8ff3737036dec8fe69a90e0759289661280537. Base shell blob e376385b89dab094beebe8753b74969067ef4806; base test blob c83b7ff79979972789c30fd01b28d8f4ad986f9f. Copies were recomputed with Git blob framing and match these authenticated metadata IDs.

Changed files: ux-overlay/vector-shell.js (one existing predicate), ux-overlay/vector-action-queue.test.cjs (harness option and four regression blocks), .github/workflows/action-queue-freshness-gate.yml (new scoped source/Node22/Docker gate), this evidence file. No routes, schemas, writers, controllers, deployments or business data changed.

Root cause/result: the existing absolute drift check used max(30 seconds, source stale cap), conflating two directional constraints. Future 60-second envelopes were accepted under a 5-minute cap; stale 20-second envelopes were accepted under a 15-second cap. Zero/negative/nonfinite caps could produce a ready empty queue. Enforce a positive finite matching cap, future skew <=30 seconds, and age <=source cap. Preserve inclusive boundaries, existing number normalization, timezone/scope checks, role/permission response rechecks, partial/unavailable behavior and workflow-owned writes. Numeric timestamp lexical/calendar validation and source authenticity are outside this repair.

Tests actually executed, Node v24.19.0:
- Original focused queue baseline: 22 pass, 0 fail.
- Regression-first old predicate: 23 pass, 3 expected failures; failures are the future, short stale-cap and zero-cap cases.
- Fixed focused queue: 26 pass, 0 fail/skip/cancel/todo; syntax check passed.
- Direct shell suites (queue, Gusto, Staffology controls, settings navigation): 49 pass, 0 fail/skip/cancel/todo.
- Broader ux-overlay suite in partial checkout: 67 total, 66 pass, 1 fail, 0 skip. Failure: `Vector workflow controller uses real authentication, saved checks and restart recovery`, MODULE_NOT_FOUND for scripts/compose-vector-local-runtime.mjs. This is a missing local composition dependency, not a passing full-runtime check.
- Repository command node scripts/run-forge-ci.mjs: exit1 at first check, MODULE_NOT_FOUND for scripts/validate-deployment.mjs in partial checkout. Repository-wide admission is BLOCKED locally and must run in a complete checkout/image.

Independent read-only reviewer: no blocking findings after comparing the complete source/test diffs to supplied exact-base copies. Independently ran focused26/26 plus19 held-out probes covering one-millisecond boundaries, small caps, calendar mismatches, invalid timestamps and permission/role/account changes during pending responses. No revoked/changed owner admitted evidence. These are synthetic local checks, not hosted proof. Scoped CI workflow follows the repository's pinned checkout/setup-node revisions and supported Node22.23.2, runs the49direct suites and unchanged full Docker admission; execution results must be read independently.

Strongest state: TESTED locally and independently reviewed, awaiting canonical adoption. Supported Node22/exact-image results pending at initial handoff. Canonical integration NOT DONE; deployment/enabling NOT DONE; hosted/customer proof NOT RUN; PROVEN/CUSTOMER-READY NOT CLAIMED. Recent owner receipts report live90ad90fcf60adaca9abacdd4ad14bf392f95e585/deploymentfaca24a2-10b9-4289-bc49-3406e44f7272, with48d staged; this task did not independently reread Railway or use that tuple as new proof.

Next action: sole canonical owner reviews/adopts this exact delta on the current canonical source, reconciles any later shell changes, runs source and final-image tests in complete checkout, deploys via approved controls, then captures authenticated manager Today→Time Review→source evidence/action→refresh/new-login/audit on the same serving SHA. Demonstrate stale/future/unavailable responses stay unavailable and valid current responses preserve existing work. Keep the full Golden Journey and backend authority requirements open.
