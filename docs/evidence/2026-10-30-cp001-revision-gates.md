# CP-001: require valid revisions in scoped sign-off proof

The existing proof serializer treated equal negative or unsafe numeric revisions
as completed attendance and payroll sign-offs. It checked `Number.isInteger`,
which accepts those values. With otherwise complete fictional evidence, both
scoped journey flags could become true. Whole-product readiness remains false.

The serializer now requires each submitted revision to be a nonnegative safe
integer, preserving exact equality with signature/audit revisions and refreshed
signed status. This matches the native weekly-signoff evidence contract in
`operations/runtime/workflow-action-evidence-contract.cjs`, which rejects a
revision when it is unsafe or negative. Zero remains valid. No business action,
authentication, policy, runner or runtime hook is added.

Base: PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`.
Base serializer Git blob: `68d4fb92d52b3a06f273a22044b3f9e16a8857a0`.
Native contract blob: `5fb1da2f290c9376841a18e6dade63574501cc23`.
The recursive exact-source tree was complete (1,850 entries) and contained no
`AGENTS.md`. Fresh GitHub source readbacks matched the recorded source Git blobs.
The canonical #501 owner retains sole integration/release authority. The donor
is independent of draft #536's team-identity change; their clean patch composition
was checked and matched the combined tested serializer bytes.

## Local verification

Use Node v22.23.2. No install or browser is needed for these checks:

```sh
node --test --test-reporter=tap scripts/vector-proof-result.revision-gates.test.mjs scripts/current-candidate-role-browser-proof.auth.test.mjs scripts/current-candidate-role-browser-proof-server.test.mjs security/runtime/proof-runner-auth.test.cjs
```

The new 24-case suite on the unchanged exact base reproduces eight false
positives: **16 PASS / 8 FAIL / 0 skips**, exit 1. Four invalid integer revisions
(negative, minimum-safe-negative, unsafe-positive, unsafe-negative) each produce
an attendance and payroll false positive. Fractional, NaN, infinite, string,
null and absent revisions already refuse. Zero, one, three and maximum-safe
integer controls remain valid scoped evidence.

The donor passes **74/74**, zero skips, exit 0: 24 new plus 50 existing signed
client/auth-handler/local-wrapper checks. An initial incomplete extraction
omitted the Dockerfile and produced one ENOENT; adding its verified exact-base
blob resolved that extraction error. Raw final TAP is retained.

Composition with #536's team validation and its 47-case journey-gate suite
passes **121/121**, zero skips, exit 0. Independent coordinator `/root` reviewed
the two guard changes and separately reran the 71 composed serializer cases,
all passing. The clean revision patch and composed team patch both pass
`git apply --check`; applied source bytes match the tested candidates.

These tests use local fictional evidence, generated keys and loopback/simulated
transports. They do not prove a browser journey, approved hosted business action,
provider acceptance, durable hosted transition or customer acceptance.

## Fresh hosted prerequisite readback

Read-only Railway platform observations and actual browser JSON bodies on
30 October 2026 still identify different serving sources:

| Service | Serving source | Active platform deployment | Protected proof-auth variable names |
| --- | --- | --- | --- |
| Proof | `61718e1862fa650136e1952f622c9d8dd4c22af8` | `c95e7a37-2504-437c-9edb-495178a88935`, SUCCESS, 1/1 running | AUTH, PUBLIC_KEY_B64, ALLOWED_EMAILS, SESSION_TTL_MS and AUDIT_STDOUT names not listed |
| Customer-designated | `90ad90fcf60adaca9abacdd4ad14bf392f95e585` | `057e19a2-7d49-4390-8705-63e71ea79a89`, SUCCESS, 1/1 running | All five `WFM_PROOF_RUNNER_*` names listed, values redacted |

Both actual identity bodies report `sourceBinding:build-file-matched`,
`fixtureOnly:true`, `productionApproved:false` and `pilotReady:false`. Both
health bodies report `status:ok`, hosted staging and
`0.6.76-hosted-staging-rc1`. These are visible JSON observations; HTTP status
and response headers are not inferred. Both services retain volumes and no
pending staged/applying work was listed. Customer's latest deployment attempt
`d9112b19-7e46-4eab-8873-9a51826870b6` remains FAILED on configured source
`48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; it is not the active source.

Variable-name presence establishes neither a matching signer nor valid values,
persisted intended actors or current implementation context. Absence from the
proof service inventory is a concrete configuration prerequisite; the older
customer service cannot establish current-candidate proof. No key value was
read, generated for deployment, installed or replaced.

The exact existing signed runner remains navigation-only with zero business
journeys. The existing [authority blocker packet](https://github.com/paulallen123/-manufacturing-wfm/blob/1b8f30222f12332fb4b8ad9f957e3b8a7a3ba32d/docs/execution/proof-action-grant-20261030/README.md)
still requires an independently governed protected action issuer, durable
server-held synthetic fixture/provenance and current approval record, and an
owner-reviewed command adapter which atomically consumes approval with the
version-checked decision and append-only audit. Login authority and client JSON
cannot supply that approval. Exact actor/tenant/run/configuration, independent
fresh-login/durable readback and browser/audit/recovery evidence must follow.
Provider writes require their separate explicit scope and independent readback;
actual customer acceptance remains outstanding.

No customer/provider/tenant/account/payroll/deployment/runtime-configuration
write occurred. CP-001 and V133–V137 remain **0/6 DONE**, and hosted signed
business journeys remain **zero**.
