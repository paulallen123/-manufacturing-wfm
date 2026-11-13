# Missing-workforce organisation inference regression

State: **REPRODUCED DEFECT / test-only owner handoff**. Product repair is not
complete. The new tests intentionally fail on current canonical source.

## Requirement and ownership

Existing #224 adaptive implementation and #265 F0/F1 onboarding require missing
source information to remain unknown and reach the existing review path.
`inferOrganisationModel` currently uses `Math.max(1, actual identified count)`.
For no usable employee identities this yields one reported person, confidence 1,
`PROPOSED` and `autoApply:true`. Consequently `buildConfigurationProposal` omits
the `organisation-structure` review decision.

Reservation:
https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6283425455

Current PR, branch, ledger and source checks found no focused missing-source
regression. Source ownership is **not** vacant: PR #274 at
`8dbbc18aec0c8f11d2ec4bf8d4932a579a02efc2` has an outstanding proposal-question
change in `implementation/runtime/configuration-inference-engine.cjs`.
Therefore no source repair, branch takeover or competing implementation was made.
The historical #224 module at `2ccf703f8642b55c1cf0d1912a2715f5a386e031` is
identical to canonical blob `d3688d27841a28d3b8801b7d4c63f254e8bf7edd`.
PR #402 readiness triage and #461 training population diagnosis have separate
scopes. UI redesign, current payroll and scheduling writers remain untouched.
External chat/lease visibility is incomplete; no runtime lease is claimed.

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
Branch: `test/vector-empty-organisation-regression-20261020`.
Only new files:

- `tests/organisation-inference-empty-source.test.cjs`
- this evidence record

## Executable owner target

The test exercises the real existing inference and combined proposal functions.
Five absent-source inputs (omitted, null, empty array, missing identity, blank
identity) must report zero people, zero confidence, no automatic application,
the existing EXCEPTION state and an organisation review decision. One valid
synthetic employee preserves existing PROPOSED behavior and input immutability.
No organisation, identity, role, customer or payroll state is written.

This is a narrow missing-population contract, not general source authenticity,
mixed-validity input, schema, malicious-object or role-inference hardening.

## Actual Node 22.23.2 execution

Initial grouped test development: existing suite plus four new grouped tests
returned **7 pass / 3 fail / 0 skip**. The groups stopped at their first omitted
input failure, so the cases were expanded into individually executed tests.

Final canonical run:

```
node --test tests/organisation-inference-empty-source.test.cjs implementation/runtime/configuration-inference-engine.test.cjs
# tests 22
# pass 7
# fail 15
# cancelled 0
# skipped 0
# todo 0
```

All six existing tests and the one valid-person control pass. All 15 new
missing-source tests fail: actual count is 1 rather than 0, confidence is 1 rather
than 0, and the organisation decision is absent. This is a real RED result,
not an expected-pass characterization, TODO, skip or waived gate.

The exact PR #274 module was separately read with `git show` into `/tmp`;
a temporary copy of the new test imported those exact bytes:

```
# tests 16
# pass 1
# fail 15
# cancelled 0
# skipped 0
# todo 0
```

Thus the existing owner's outstanding source also retains the defect.
No speculative repair was applied even temporarily. Syntax and diff checks pass.

## Review, integration and next action

Independent source review of this test-only package is pending. Do not retry the
known unavailable local Codex review server. Parent coordination can arrange the
bounded review. This is distinct from independently accepted PR497 and PR500.

The existing #274/implementation source owner should preserve actual zero counts
and require nonempty evidence before organisation auto-application, retaining
valid population behavior and the existing review contract. They should run the
above 22 tests and relevant proposal/consumer tests on their repaired head.
The exact implementation remains their responsibility; this PR adds no duplicate
engine or alternative inference path.

Sole canonical integrator remains Continue customer proof,
`01a12a1a-6c4a-7221-9862-ca8ddcd0f5a1`. Adoption into any explicit Docker test list,
source reconciliation, combined admission and release remain with that owner.
Keep draft and do not merge a failing regression alone as completed delivery.

No Docker/image, browser, hosted/customer or provider proof ran. No runtime,
source module, configuration, workflow, credential, archive, canonical ref,
merge, deployment, real payroll/personnel action or customer contact changed.
