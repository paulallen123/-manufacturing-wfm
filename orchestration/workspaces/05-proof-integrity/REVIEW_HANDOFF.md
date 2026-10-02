# Exact local review handoff

Review changes-manifest.json for the final3repository paths, mode100644, direct frozen source identities and exact proposed Git/SHA256 hashes. All other capsule runtime files are verification inputs, never shipping additions. Full work/src and work/native-src were not mutated.

Run with work/tools/node22/node.exe: work/proof-gate-repair/run-tests.cjs REVIEW-focused focus, then run-tests.cjs REVIEW-affected. The runner captures raw logs and structured exit/runtime receipts, disables agents bootstrap and uses capsule-local temporary SQLite. Fixed targets were tested4/4focused and52/52affected. No network/provider/model/live calls were executed.

Meaningful failures are evidence/01-focused-red.log (both original malformed admission cases accepted200) and07-persisted-red.log (both malformed stored receipts retained authority). Intermediate02/03logs include a regression assertion mistake referring to a nonexistent response property/SQL key; corrected to actual decision_key and direct isolated durable-state assertion.09affected49/52 exposed nonstrict frozen fixture compatibility; final replay revalidation is scoped to existing explicit strict/hosted mode, and10affected52/52 passes. All logs remain for audit.

Scope is proof admission integrity only. Remaining customer gates require actual customer source/policy/training and independent hosted verification. Root owns exact current-head admission to its single review lineage after independent review. provenBaseSha andconvergenceBaseSha remain null; no release candidate, publication, deployment or hosted proof was produced here.
