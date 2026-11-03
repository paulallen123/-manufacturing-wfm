# Staffology payroll input preflight — V053 / V055

This adds a read-only CLI for checking the existing operation profile against an exact retained canonical payroll state snapshot. It creates no new approval format, provider adapter, operation route, database, runner or release path. The Staffology owner in #292 and the sole canonical integration/release owner in #501 retain adoption and operational authority.

The current profile parser checks the profile's structure and internal bindings. It accepts a synthetic `expectedBasicPay: "1250.00"` even when the retained released line represents 1.25 hours at 10.00, or 12.50. The existing runtime operation later rejects this mismatch; this is **not a demonstrated runtime dispatch bypass**. The missing capability was a standalone no-effect input check before invoking an operation. This CLI reuses the existing parser, bridge and mapper to provide that check.

## Existing input formats

Run on a trusted copy of the intended exact source. Supply private files through the existing owner's controlled evidence path:

```sh
node scripts/staffology-payroll-proof-preflight.cjs \
  --profile /private/staffology-operation-profile.json \
  --state /private/canonical-tenant-state.json \
  --actor /private/current-principal.json \
  --binding /private/current-binding.json \
  --seal /app/.wfm-build-source-sha
```

- `profile` is the unchanged JSON value of `WFM_STAFFOLOGY_OPERATION_JSON`; do not export a credential. It requires an active payroll scope and a complete released-batch manifest. Unknown top-level fields, including credentials or a fabricated approval flag, are rejected.
- `state` is the existing canonical tenant state shape read by `Bridge.createRuntime`. Required payroll data includes the exact released unsent batch, retained CSV and checksum, all released lines, period dates and source-bound onboarding-ready staff identities. The CLI reads this snapshot; it does not export it or prove its provenance/freshness.
- `actor` is an existing canonical principal record containing tenant, email and an array of permissions with `payroll.export` and `company.configure`. This is a consistency check, not authentication or verification of a current protected principal.
- `binding` uses `Boundaries.exactBinding`: exactly `tenant`, `implementationRunId`, `candidateSha`, `deploymentId`, `configurationId`, `employerId`. If a hosted profile omits deploymentId, the existing parser resolves it from this supplied binding and requires its UUID shape. The source seal must contain the same full lowercase SHA, optionally followed by one newline. The owner must independently establish that all files and the seal belong to the intended current source/deployment/tenant/run/configuration.

No ambient credential or configuration variable is read. A literal unusable offline marker only satisfies the existing pure parser's credential-shape requirement. No credential readiness, provider nonproduction classification or actual operation approval follows from it.

## Result and limits

Exit 0 means the supplied inputs are internally consistent with the current source contract. Exit 1 returns a redacted blocker code. Neither result creates authority. Both always return `authorizationGranted:false`, `proofEligible:false`, `providerRequestsPerformed:false`, `credentialReadinessVerified:false`, `currentPrincipalAuthorityVerified:false` and `inputProvenanceVerified:false`.

Successful output contains counts, the supplied source SHA, input digests, the canonical manifest digest and actual SHA-256s of all four imported source modules. It contains no employee identities, email, payroll code, amount, credential, raw source profile, error message or private file path. Inputs remain private; each file is bounded to 32 MiB. The script does not write files, construct a coordinator/authority/store, or call a transport.

The check reuses `loadConfiguration`, `exactBinding`, `prepareBatchManifest`, `preparePayroll`, `mapPayroll` and `businessKey`. It requires every retained released line to be supported and exactly mapped, reconciles immutable line digests and financial expectations, and refuses duplicate business operations. It preserves all runtime authority and dispatch/readback gates.

V053 and V055 remain **BLOCKED** until the existing owner supplies independently verified current approval of the exact nonproduction provider/employer/cohort/open run/released batch/mapping/amount and current protected actor; passes exact image/security/recovery admission; and obtains actual VECTOR dispatch, provider acceptance, independent durable readback, audit and the intended-role customer journey. A successful input comparison or historical provider-only test cannot satisfy these gates. UNKNOWN must remain held until independently reconciled by the existing runtime.

## Source and verification

Base: #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. Four imports are unchanged and their local Git blob identities were matched to the fetched exact base:

| Source | Git blob |
| --- | --- |
| `integrations/staffology/canonical-operations.cjs` | `c5c7fd3072a3a6c16ea7d0929f4fca5d75171247` |
| `integrations/staffology/canonical-runtime-bridge.cjs` | `19f7f451ec1db24e19f5b75bd685ebe3d6dc5e70` |
| `integrations/staffology/staffology-adapter.cjs` | `ec05deedeb5581a4b2f109eb108c796b0e62e59c` |
| `integrations/staffology/canonical-production-boundaries.cjs` | `fa24af60d4e1c0eafb29249688f5f1b1c1a9f8b2` |

Focused test command:

```sh
node --test --test-reporter=tap scripts/staffology-payroll-proof-preflight.test.cjs
```

The tests use synthetic input records and the actual canonical parser/bridge/mapper. The integration test spawns the real CLI, validates pass/refusal exit codes, checks redaction and compares every input file hash afterward. It uses no provider simulation or mocked POST. The initial parser-only comparator failed 8/8; its first failure was the deliberately mismatched expected amount. Initial Node22 full candidate result was 8/9 because the test assumed empty stderr while this executor emitted its experimental proxy warning. The corrected test permits that environment warning while refusing private-path/error leakage. An independent reviewer additionally required array-shaped actor permissions and its negative test. Current exact result and independent review are recorded in the PR receipt.

Earlier #265 comments could not be fetched in this check (`Transport closed`); no complete historical approval audit is claimed. The current ownership register explicitly limits historical preparation to read-only work and `NEXT_PROOF_OPERATION.md` explicitly says its proposal is not executed or an approved operation.

Owner adoption: review these new files, reconcile imports against the resulting exact SHA, rerun the CLI tests, and use the check as a private input diagnostic within the existing approval process. Do not wire `contractValid` to a runtime approval or readiness flag.

## Exact reviewed receipt

2026-10-30, Node **22.23.2**, command above: **exit 0, 9/9 pass, 0 skip**. Primary TAP SHA-256 `5ab5a184bc9c5b29ac0b9b2d1d4ef75af39e35004022129447c66498e9fe4ab0`. Independent session reviewer `/root` inspected the files and reran the corrected suite on Node22: **9/9, zero skips**, no important in-scope finding after requiring array-shaped permissions. This is a bounded offline review, not formal release approval.

Reviewed checker SHA-256 `7bcd73bf1b5f92ce157c569a7f7f6d4e12d7a5443d527f876b520257798ed511`, Git blob `6ea53d84021361cef98d0e5f9b938f25e2c0ebec`; test SHA-256 `af2044729a1129358efe080b7dcc90895e0ab22198226e6597c4d118393a1dd9`, Git blob `372cb893158428ba468675e11b05191e5a5d2bfd`. Check and test syntax passed on Node22. No full application/image, hosted, provider or customer test was run.
