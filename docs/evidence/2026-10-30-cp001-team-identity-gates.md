# CP-001: reject unidentified payroll team proof

The scoped payroll proof serializer accepted an expected team identity of null,
missing, empty, whitespace, number or boolean when the same malformed value was
present in a sign-off. Set equality established agreement, but did not establish
an identified team. With otherwise complete synthetic release evidence this
incorrectly set `scopedPayrollJourneyVerified:true`. Whole-product readiness
already remained false.

This change adds one validation condition to the existing serializer: every
expected team identity must be a string containing a non-whitespace character.
No identity is normalized. Existing exact set membership, distinct team/signature
counts, revision, batch, checksum, audit and fresh-login requirements remain.
There is no new runner, controller, route, account or provider operation.

Base: PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`.
Base serializer Git blob: `68d4fb92d52b3a06f273a22044b3f9e16a8857a0`.
Source and test files were fetched through the connected GitHub reader and all
14 materialized input Git blobs were verified. The changes are isolated from
the V005/preflight work and the #528 documentation writer. Existing PR #501
owner retains adoption, protected signer, integration and release authority.

## Reproduction

Use Node v22.23.2 with its built-in SQLite support. No package install or browser
is needed. On the containing candidate commit:

```sh
node --test --test-reporter=tap scripts/vector-proof-result.journey-gates.test.mjs scripts/current-candidate-role-browser-proof.auth.test.mjs scripts/current-candidate-role-browser-proof-server.test.mjs security/runtime/proof-runner-auth.test.cjs
```

Author: exit 0, **97/97 PASS, 0 skips**. This comprises 47 added evidence-gate
tests and 50 existing signed-client, signed-auth-handler and local HTTP-wrapper
tests. Independent reviewer `/root` inspected the exact candidate diff and
reran the same Node22 command: **97/97 PASS, 0 skips, exit 0**. Actual primary
task `/root/customer_proof_unblock`; parent requested Sol xhigh, but the runtime
did not expose a separately verifiable model identifier. No additional worker
was spawned. A fresh clean temporary checkout passed `git apply --check`, and
the applied source/test bytes matched the tested candidate exactly.

For the fail-first control, put the added test file alongside the unchanged base
serializer and run `node --test --test-reporter=tap scripts/vector-proof-result.journey-gates.test.mjs`.
The exact base exits 1: **40 PASS / 7 FAIL / 0 skips**. Each failing assertion
expects malformed or missing team identity to remain unverified. The ordinary
two-team, reordered-signature and all missing-evidence controls pass. Raw TAP
receipts and digests are in `evidence/vector-cp001-identity-gates-20261030/`.

An earlier incomplete local extraction failed to load `passkey-schema.cjs` under
Node24; that was an extraction error, not a product failure. The dependency was
fetched at the exact source, verified, and the supported Node22 runs above are
the relevant verification results.

## Serving state and remaining proof

Fresh actual browser reads on 30 October 2026, followed by Railway metadata:

| Service | Actual `/api/runtime-identity` | Platform deployment | App claim boundary |
| --- | --- | --- | --- |
| Existing proof | `61718e1862fa650136e1952f622c9d8dd4c22af8`, build-file-matched | `c95e7a37-2504-437c-9edb-495178a88935` SUCCESS | fixtureOnly true; productionApproved false; pilotReady false |
| Customer-designated | `90ad90fcf60adaca9abacdd4ad14bf392f95e585`, build-file-matched | last SUCCESS `057e19a2-7d49-4390-8705-63e71ea79a89`; latest attempt `d9112b19-7e46-4eab-8873-9a51826870b6` FAILED | fixtureOnly true; productionApproved false; pilotReady false |

Both visible `/api/health` JSON bodies reported `status:ok`, `mode:hosted-staging`
and release `0.6.76-hosted-staging-rc1`. These were read-only browser DOM body
observations; no HTTP status or response headers beyond the displayed JSON are
inferred. Railway described no staged work on either service. No serving source
or live state changed.

This fixes a synthetic proof-reporting false positive. It does not implement
the signed hosted business journeys. The existing runner's signed branch still
reports `businessJourneys=0`, PARTIAL, with null leave/attendance/payroll journey
evidence. Protected matching signer/actor/tenant/run/configuration, intended-role
actions and authoritative durable readback after refresh/fresh login, retained
browser/audit/recovery evidence, bounded approved nonproduction provider
acceptance/readback and real customer acceptance remain unproved. No customer,
provider, account, payroll, tenant, deployment or runtime-configuration write
was performed. CP-001 and V133–V137 remain **0/6 DONE**.
