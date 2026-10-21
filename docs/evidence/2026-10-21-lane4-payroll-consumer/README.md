# Payroll consumer evidence — lane4, 2026-10-21

## Exact scope and ownership

Canonical release/vector-customer-ready-candidate-20260925 was freshly verified before execution and again after: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
PR497 remains `ea6c602868e34022de417fd12ad315389dfccb66`; PR495 remains `b6446b13bc52cc261db815b00903ffb75b20e6ee`, both open/draft/unmerged. Actual diffs are respectively two test/evidence files and three comparator/test/evidence files. No runtime files are changed here.

Read #202 payroll reconciliation/leakage requirement, #288 intake and relevant payroll ownership/review records, and #265 body. Broad #265 comments connector retrieval failed; relevant explicit reservation is linked by #288: https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6283272813 . No AGENTS.md or .agents skills were found in the selected workspace. Existing #220, #378/#396 and #497 scopes remain intact. #495 owns its receipt repair.

New evidence-only directory reservation: https://github.com/paulallen123/-manufacturing-wfm/issues/288#issuecomment-6315214565 . Sole integration/release owner is task `01a15e4a-0bc0-7093-84bf-e963f7750039` under parent delegation; this supersedes stale owner IDs in historical records.

## New missing gate

PR497 review explicitly left a precomputed byte/hash oracle and all-19-field coverage as held-outs. `consumer.test.mjs` reuses its signed synthetic fixture/module loader, removes the unused decoder, injects a fixed VM clock, and tests real domain `dispatch -> batchById -> JSON reload -> retry` in CommonJS and browser-global VM modes. Its literal CSV expectation specifies all 19 columns, CRLF, quoted Unicode and leading zeros. Expected values were checked against fixture arithmetic and source schema; an exploratory run was used to inspect formatting, so this is not a blinded independently invented fixture. Independent review checks the literal expectations.

Expected UTF-8 SHA256: `02f4c4e56433cc4ea6c87b82b2396cb106f3f9aa04b4b23b42c00112ea0893f4`.
Sealed archive SHA256 is asserted: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`.
Source uses canonical money patch; it does not adopt PR494 or PR495.

## Commands and actual results

Runtime `/workspace/wfm-cloud/bin/node`, **v22.23.2**. Run from repository root unless noted.

- `node --test docs/evidence/2026-10-21-lane4-payroll-consumer/consumer.test.mjs`: **2 pass / 0 fail / 0 skip**, exit0, final source blob `90e48411bf60dc7c60021b555a03275c37e20d8e`.
- In separate detached PR497 worktree at exact `ea6c602...`: `node --test tests/payroll-export-serialization.test.mjs scripts/patch-payroll-money.test.mjs`: **20 pass / 0 fail / 0 skip**, exit0. This closes the previously unexecuted independent supported-Node gate for that exact package, not image admission.
- `node --test docs/evidence/2026-10-21-lane4-payroll-consumer/receipt-red.test.mjs`: **1 pass / 9 fail / 0 skip**, exit1 intentionally. Reproducer loads exact PR495 module with `git show b6446b13bc52cc261db815b00903ffb75b20e6ee:operations/runtime/payroll-release-variance.cjs`; fetch that commit before reproduction if absent. Blob `576c9dfdf6606f56050c3a029466129963520996`.
- `git diff --check`: PASS.

Full TAP transcripts are adjacent. No unexpected implementation failure occurred in the new export gate. Initial GitHub CLI API retrieval failed Forbidden; Git transport and connector reads succeeded. Some connector discovery calls rejected incorrect argument names; corrected calls succeeded. These are tooling failures, not product results or approval denials.

## Receipt owner findings reproduced, not repaired

Valid control MATCHED. Coercive hash retains a synthetic private employee field while claiming employeeDataIncluded:false; coercive currency is accepted. Non-enumerable and symbol private extras are accepted. Changing tenant getter yields MATCHED for foreign tenant. Changing total getter yields REVIEW_REQUIRED with NaN total (JSON transcript renders NaN as null); this reproduction does not claim MATCHED for that particular NaN case. Throwing getter and proxy errors escape rather than BLOCK. Output and nested evidence are not frozen. The last immutability case is hardening, distinct from the eight input-validation failures.

PR495 source remains independently BLOCKED. Existing owner must implement inert own-data snapshot, primitive strings, rejected active/hidden input, stable validated calculations and regression coverage, then obtain re-review. No competing repair is included.

## Boundaries and next action

This is synthetic domain-consumer evidence only. No authenticated HTTP, actual browser, SQLite restart, installed image, spreadsheet/provider import, source authentication, canonical merge, deployment, freeze, tenant or real payroll/personnel write occurred. Parent should forward this evidence plus exact PR497 package to the sole integrator for adoption and final-candidate image/hosted gates. Local PASS is not deployment or customer readiness.

## Independent review

Read-only reviewer `/root/review_lane4` independently executed final consumer blob `90e48411bf60dc7c60021b555a03275c37e20d8e` on Node22.23.2: 2/2 PASS. Independently executed receipt reproducer blob `576c9dfdf6606f56050c3a029466129963520996`: 1 pass/9 expected failures, exit1. No blocking finding in the evidence package. Reviewer confirmed NaN status is REVIEW_REQUIRED and pinned tests require explicit rebinding for any future repair. This is not formal GitHub approval.

Initial staged diff check caught trailing spaces in Node TAP diagnostics; logs were whitespace-normalized and the staged check rerun. Test outcomes and diagnostic content are unchanged.
