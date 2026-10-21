# Reject absent external record identities

Requirement: #265 integration source binding/reconciliation must not manufacture
an external record identity when a row has no ID. `String(undefined)` and
`String(null)` previously produced accepted identities equal to the real string
IDs "undefined" and "null". The existing helper now rejects null and undefined
before coercion. Other ID normalization/hash behavior is unchanged. This is not
general type/schema/active-object admission or source authentication.

## Ownership correction

Base: `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
Branch: `fix/vector-missing-record-identity-20261021`.
Reservation: https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6315114559

Original PR194's two-file Fracttal report describes its initial scope. Its current
actual diff from integration/global-fabric-v1 at73aad0d to70f0657 has191 files,
including this helper/test as additions. The source already matches canonical
blob `fb81bcd576e60a0d27d5a4b1ebe04ca9717f3e9f`. Neither membership nor historical
implementation establishes a current exclusive lease. Targeted current PR,
branch and ledger checks found no focused null/undefined identity writer or
explicit current helper lease. Earlier blanket ownership-blocker claims were
corrected before reservation. The originating conversation supplied by parent is
not treated as a resumable executor ID. No PR194 branch, PR274, provider,
credential, controller, release, or parallel operational-intelligence file changed.
No workspace AGENTS.md or .agents skill files were found.

## Actual execution

Node v22.23.2, existing batch test with new regressions against base:
17 tests;14 pass;3 fail;0 skip. Omitted, explicit undefined and null IDs each
failed with "Missing expected exception". Existing13 tests and valid-ID control
passed. These are expected pre-fix failures, not release successes.

After the one-line guard:

```
node --test integration-fabric/runtime/batch-reconciliation.test.mjs integration-fabric/runtime/scope-partition.test.mjs integration-fabric/runtime/dataset-coverage.test.mjs
# tests 28
# pass 28
# fail 0
# skipped 0
# todo 0
```

The compatibility control pins base hashes for legitimate "undefined"/"null"
string IDs, keeps numeric0 equivalent to string"0", distinguishes "001" from
"1", and preserves empty-string rejection. Existing dimensions/scope tests stay
unchanged. Diff check passes. Independent review pending at writing; exact
review receipt will be attached to the PR/authoritative ledger.

Only the helper, its existing test and this evidence file change. Synthetic
pure-function data only; no persistent state, worker or provider action.
Docker already copies the helper, but checked source has no production call to
makeScopedExternalIdentity. This closes the helper defect, not runtime import
admission or customer proof. No image/hosted/provider test, merge or deployment
ran. Sole canonical integrator retains adoption, consumer wiring and exact
candidate/release gates. Keep draft pending those gates.
