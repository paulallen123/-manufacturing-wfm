# V005: adopt reviewed offline proof-access preflight

This isolated donor applies the already reviewed two-file V005 configuration
repair to exact PR545 `2d0f4e41e3b0463386b2887f39afa064068f9166`, tree
`b6e21c4afa9880c651fe0898235cd4695ce4bfca`. It does not activate the runner.
Canonical PR501 remains `61718e1862fa650136e1952f622c9d8dd4c22af8` and retains
sole integration/release ownership; PR545 and all other owner branches are
untouched. V005 remains BLOCKED on protected authorization and hosted proof.

## Reused source and bounded adoption

The donor is the existing PR528 documentation packet at
`152482629f8930096b7eafe5923e420d7e0bfae4`, under
`docs/execution/lane-register-20261029/handoffs/V005-preflight-parity-20261030/`.
Fresh GitHub readbacks verified the source/test/patch. The patch applies cleanly
to PR545, whose two preflight baseline blobs still equal exact PR501.

| Path | PR545 baseline Git blob | Reviewed adopted Git blob |
| --- | --- | --- |
| `scripts/proof-access-preflight.cjs` | `80668b6f9c1e10d97501ca41e50ca59c684778ee` | `9d4d3a8cd53c2d93d16fd09991920470fbb27832` |
| `scripts/proof-access-preflight.test.cjs` | `d9eded07d6d30f3599afbb7c0adfa024351eacda` | `53544fd9ed1a6b6df9af4719bef3747b01a9958b` |

The offline preflight now matches the existing client constructor for trimmed,
bounded deployment/tenant/run bindings, canonical base64 PKCS8 PEM Ed25519 signer
encoding, actor shape/length/role/tenant isolation, string-only source/config
digests, and valid HTTPS origins with or without a terminal slash. Failures
report field names and retain the explicit offline-only scope. No session,
signer trust, persisted actor identity, implementation binding or approval is
established by `CONFIGURATION_VALID`.

The complete fresh PR545 recursive tree had no AGENTS.md. All 1,714 parent blobs
and modes were matched to the isolated snapshot; its Git tree exactly matched
PR545. Exactly these two existing source/test paths change. All other 1,712
parent blobs, Docker/Forge, launcher, generated bundle, frozen marker, bootstrap,
schema and lockfiles retain parent bytes. Generated full-source outputs were
kept in a separate disposable source copy and excluded from publication.

## Fresh local verification

All runs use Node v22.23.2; counts overlap and are not additive customer proofs.

| Check | Result |
| --- | --- |
| Reviewed expanded test against unchanged PR545 preflight | 3 PASS / 8 intended FAIL / 0 skips, exit1 |
| Adopted preflight + launcher/runtime-identity preflight + signed-client/auth-handler/HTTP-wrapper composition | 99/99 PASS, zero skips, exit0 |
| Additional primary-authored missing-binding/CLI/offline heldouts | 11/11 PASS, zero skips, exit0 |
| Full unchanged ordinary Forge command on this source plus adoption | 16/16 commands, 299/299 TAP PASS, zero skips, exit0 |
| Independent coordinator `/root` exact diff review and reruns | 99/99 composition and 11/11 heldouts PASS, zero skips |

The full Forge run used local-only `TAR_OPTIONS=--no-same-owner` for archive
extraction. This setting is absent from CI and the source delta. A first
cwd-relative byte-verification command used an incorrect relative path; its
separate test invocation still passed. The corrected byte check independently
matched both adopted files to their reviewed Git blobs; no source mismatch was
found or concealed. The recorded verification receipt identifies the correction.

From the repository root:

```sh
node --test --test-reporter=tap scripts/proof-access-preflight.test.cjs docs/execution/proof-runner-activation/launcher.test.cjs docs/execution/proof-runner-activation/preflight.test.cjs scripts/current-candidate-role-browser-proof.auth.test.mjs scripts/current-candidate-role-browser-proof-server.test.mjs security/runtime/proof-runner-auth.test.cjs
V005_SOURCE_ROOT=. node --test docs/execution/vector-v005-preflight-adoption-20261030/heldout-config.test.cjs
TAR_OPTIONS=--no-same-owner node scripts/run-forge-ci.mjs
```

The added heldouts cover each of nine missing/falsy required bindings, a CLI
with no configuration, field-name-only output and a valid fictional config
which performs zero requests. All keys/actors in these checks are generated or
fictional local fixtures. No protected credential or service is used. Raw
baseline TAP and full-source log are retained as deterministic gzip files;
manifest SHA256 values identify both compressed and decompressed bytes.

## Explicit CI and activation handoff

The ordinary Forge and Docker source commands still do **not** select
`scripts/proof-access-preflight.test.cjs`. Their successful existing tests do
not independently exercise this repair. The explicit 99-case command above
does. Per coordinator ownership, the V086 workstream currently owns those
shared selector files; this two-file donor does not create another writer.
The sole canonical owner must include the V005 regression in the later reviewed
CI/Docker union, preserve every existing selector, and rerun the composed
source/image gates. No selector adoption, new freeze renewal or exact-image/CI
success is claimed here.

The existing protected operator must separately establish matching current
signer/public key, persisted allowed actors and exact tenant/run/configuration
through the approved binding route. Latest read-only proof receipts still
distinguish current fixture-only proof61718 from older fixture-only customer90ad;
this source-only adoption did not make a new runtime observation or change either
service. Structurally valid inputs cannot manufacture signer trust, approved
synthetic provenance or independent per-action authority. The signed runner's
business journey gap, actual browser/persistence/fresh-login/audit/recovery,
provider acceptance/readback and genuine customer acceptance remain open.

No runner activation, signer installation/rotation, tenant/personnel/customer/
payroll/provider action, deployment or readiness claim. V005 remains BLOCKED;
no lane is marked DONE.
