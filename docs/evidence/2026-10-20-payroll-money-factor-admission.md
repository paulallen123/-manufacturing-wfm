# Payroll factor admission — 20 October 2026

Status: TESTED in isolation; independently reviewed. Not canonically integrated, DEPLOYED/ENABLED, PROVEN or CUSTOMER-READY.

## Requirement and source
Issue #202 requires payroll-grade reconciliation, labour cost correctness and prevention of payroll leakage; F1.8 requires the complete operational Golden Journey. A bounded source defect allowed missing allowance entries to disappear during Array.reduce and custom traversal to replace factors.
Source: https://github.com/paulallen123/-manufacturing-wfm/issues/202
Reservation: https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6283275307

## Ownership and conflicts
Read current Library backlog v44 and release intake v67, #288 comments, latest #265 comments, open PR scopes and money branch search. No focused writer was visible. #431 and #488 consume the money helper but do not own edits to it. #265's payroll-export serialization reservation is a separate test-only fence. External chats and jobs are not comprehensively visible; no runtime lease is claimed.
Single canonical integration/release owner remains Continue customer proof. No shared composer, archive, workflow, trigger, runner, controller, deployment or business data was edited.

## Exact base and changed files
Canonical release/vector-customer-ready-candidate-20260925 independently resolved twice to 48dce8f697825c8cd5f99b3e5aeea3953647f8c2.
Only:
- operations/runtime/payroll-money.cjs — original blob e632abdfb83fb480033510ed580c0c2b33c1c07b; changed blob a97af941a0313808f3d71b8c3b9428d5108a18f7; SHA256 b68a7c895abc1843abef5718a5e394974db26413cb34d97f91b791337c18e2f5.
- tests/payroll-money-factor-admission.test.cjs — new; blob 5b41d822dd9942c57c51cff4c1ef52a35738277a; SHA256 514359d1c5f912cf664ca36e9dd47550130649c05cbf2f9a1c5a466f5172f0a2.
- docs/evidence/2026-10-20-payroll-money-factor-admission.md — this record.

## Implementation
Read each factor through its own data descriptor into an internal null-prototype collection. Reject holes, inherited indices, accessors, non-finite/negative operands, empty multiplier collections and excessive lengths. Calculate using indexed traversal without caller reduce/some/iterator dispatch. Retain exact rational arithmetic, valid empty allowances, explicit zero, rounding boundaries and self-contained factory serialization for the browser composer.

## Executed tests and failures
Node v24.19.0.
Before repair: new regression suite 8 tests, 2 passed / 6 failed. Missing expected exceptions and custom reducer substitution reproduced on both server and VM-embedded browser factory.
After repair: new suite 8/8.
Combined command:
node --test scripts/patch-payroll-money.test.mjs tests/payroll-money-factor-admission.test.cjs
Result 24/24, zero failures/skips. Existing 16 tests include server/browser legacy/contract pricing, independent rate/minute matrix, breaks, effective rate changes, exact decimal allowances, overtime, oncosts, reconciliation and source drift denial.
Sealed archive was copied read-only from an available local cache after its Git blob matched canonical tree blob 0c8bb0251d207ec0af0808dd2627360a946a2cb3. Composer and existing tests were fetched by exact canonical blob. No archive change.

## Independent review
Separate read-only reviewer review_payroll_factors: no Critical/Important findings. Reviewer independently reran 8/8 and reported 74/74 synthetic assertions across server and serialized VM factories: all factor paths, throwing traversal getters, frozen/null-prototype/cross-realm inputs, 1000-element limit, invalid multipliers and penny rounding. No source edits or external writes by reviewer.

## Integration, deployment and proof
Isolated branch only. Canonical adoption pending; no merge, deployment or customer mutation. Latest owner records describe live older source 90ad90fc… and staged canonical 48dce8f…; this task did not independently refresh Railway and does not treat those records as live proof.
Supported Node22.23.2, full exact image, consumer admission and authenticated hosted/customer proof NOT RUN. Shell clone lacked credentials; source/branch access used the authenticated GitHub connection.

## Risks and next action
This is a trusted same-realm computation boundary, not arbitrary Proxy isolation or source authentication. Full product consumers must be verified on the reconciled artifact. Canonical owner must adopt these exact bytes, run supported Node22 and full image/consumer checks including #431/#488 if adopted, then execute approved synthetic hosted payroll cost/reconciliation evidence. Keep real payroll/personnel and release approval controls unchanged.

