# V053/V055: offline payroll adversarial owner handoff

This test-only packet adds seven adversarial cases to the existing #535 offline Staffology diagnostic. The unchanged diagnostic passes complete two-worker input, refuses non-primary financial/identity/mapping drift, swapped released-line digests and duplicate provider business operations, and preserves all six false authority/proof/readiness flags. No product defect was reproduced and no product implementation change is proposed.

The exact parent is #535 `30b86acc2cabd8e0396dfd0e63efc21578c5c53a`, based on canonical #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. #535 remains the existing diagnostic donor; #292 owns Staffology and #501 owns canonical integration/release. This packet does not move those refs or create another provider/approval/runtime path. New tests and evidence are an owner handoff, not an approval to adopt or operate.

## Fresh verification

Supported Node **22.23.2**:

| Check | Result | What it establishes |
| --- | --- | --- |
| Existing #535 nine tests plus seven new cases | 16/16, zero fail/skip, exit 0 | Offline input comparison and unchanged inputs only |
| Three disposable mutations | Three expected exit 1, all detected | Tests detect primary-only iteration, removed collision check and enabled authority claim |
| Existing signed-runner independent heldouts | 24/24, zero fail/skip | Synthetic authentication seam; environment-only approval causes zero business actions |
| Existing Gusto HTTP/process recovery fixture | 3/3, zero fail/skip | Loopback HTTP, temporary SQLite and SIGKILL/reopen; provider responses replaced |

The signed-runner and Gusto checks are separate supporting receipts, not new tests or business acceptance counts. Their tested blobs and import dependencies were matched to exact remote #501 `61718e18` and #540 `57907609bca28aa0401298db3089cb49bf1beb0f` respectively. The six payroll checker/test/import blobs match exact #535. See `evidence/source-hashes.json`. Node syntax checking of the new test passed. These are author-session checks; no new independent review or formal release approval is claimed.

The new file goes at `scripts/staffology-payroll-proof-preflight.adversarial.test.cjs` beside #535's existing checker. From the intended checkout:

```sh
node --test --test-reporter=tap scripts/staffology-payroll-proof-preflight.test.cjs scripts/staffology-payroll-proof-preflight.adversarial.test.cjs
VECTOR_PREFLIGHT_SOURCE_ROOT="$PWD" VECTOR_PREFLIGHT_TEST_NODE=node python docs/execution/payroll-provider-followup-20261030/run-mutations.py
```

The mutation runner copies only the offline checker, new test and its four imports into disposable directories. It never modifies the source checkout. The fictional retained CSV/checksum is a consistency fixture, not a real export or evidence of snapshot provenance. The transport trap checks that the offline comparator does not reach ambient `fetch`; it does not certify an actual provider connection.

## Authority and actual proof remain missing

Every returned offline result retains `authorizationGranted:false`, `proofEligible:false`, `providerRequestsPerformed:false`, `credentialReadinessVerified:false`, `currentPrincipalAuthorityVerified:false` and `inputProvenanceVerified:false`. `contractValid:true` is only supplied-data consistency. The canonical bridge's internal `approved:true` is a mapping comparison input; it does not issue or consume a runtime approval.

Fresh #535 metadata still reports open/draft at `30b86acc`; its sole issue comment is an unrelated Vercel preview failure, not an operational approval. #501's source remains `61718e18`; its full comments failed with `Transport closed`, so this is not an exhaustive historical authorization audit. No current protected payroll grant, credential readiness or intended-role authorization was supplied or established in this work. That is a missing-evidence boundary, not a claim that all possible approvals have been disproved.

The existing signed-leave design at `1b8f30222f12332fb4b8ad9f957e3b8a7a3ba32d` explicitly leaves independent issuer policy, durable synthetic fixture provenance and an owner-reviewed atomic command adapter unresolved. Its local generated-key model cannot approve a hosted leave action. Signed authentication/navigation still returns PARTIAL with leave/attendance/payroll journeys null. Gusto denial/recovery in replaced-provider fixtures does not certify current customer/provider consent, fresh login or payroll dispatch.

**V053/V055 remain BLOCKED.** No actual provider request, payroll operation, protected grant creation, hosted business mutation, customer/personnel change, deployment, image admission, customer acceptance or readiness claim occurred.

## Next accountable actions

1. #535/#292 owner reviews this bounded test delta and reruns the 16 tests and mutations on the exact reconciled source. #501's sole owner controls adoption and exact-image/security/recovery admission.
2. The existing secure operator and payroll owner independently provide current nonproduction operation approval and exact provider/employer/cohort/open-run/released-batch/mapping/amount plus protected actor/credential bindings through the existing approval process. This packet supplies none of those values.
3. Only after those gates are established, the authorized operator executes the existing VECTOR dispatch path once, retains provider acceptance and independently queries durable readback/audit. UNKNOWN remains held until reconciliation. Complete intended-role refresh/fresh-login payroll journey and customer acceptance separately.
4. Signed-leave proof remains with its existing issuer/proof/integration owners. Resolve the server-held provenance/approval/atomic-consume contract before adding any hosted business hook.
