# V002/V007 cumulative image-admission supplement

The new V014 setup-only worker-boundary and V088 Gusto HTTP/process-recovery regressions were absent from the explicit Docker admission commands. This three-file supplement makes those tests run against both source and the modules copied into `/app`. It stacks on the frozen reviewed source proposal PR #537 at `521affbc019fb2ef48b1e3740401613b16bf408a`, whose sole parent is canonical PR #501 `61718e1862fa650136e1952f622c9d8dd4c22af8`. No canonical branch was changed. This is an owner-ready image-admission package, not a completed image build or customer result.

## Bounded behavior

- `Dockerfile` adds a serial source-stage invocation of the unchanged V014/V088 assertions and the V067/V103 advisory-helper suites. The source stage is consumed by `hardened-runtime` through its existing mandatory autonomy receipt. All previous Docker commands remain present.
- A second gate copies only three temporary test/fixture files and runs the V014/V088 tests with `VECTOR_IMAGE_ADMISSION_ROOT=/app`. The tested modules are the existing explicit `/app/integration-runtime` and `/app/implementation-runtime` copies, not temporary source-tree module duplicates. The fixtures are removed after successful execution. The final image inherits this gate from `hardened-runtime`; the installed-archive descendant remains required.
- Two test-only loaders select installed modules when the variable is supplied. With no variable, they retain their source-tree targets. All behavioral assertions and production modules are unchanged by this supplement. The Gusto provider response fixture remains synthetic and the HTTP server binds to loopback.
- The V067/V103 helpers receive source admission only. This package adds no authenticated runtime consumers, provider calls, safety authority or helper runtime packaging.

## Fresh execution

Implementer `/root/image_gate_unblock`; independent reviewer `/root`. The reviewer inspected the exact bounded diff and separately reran the copied installed-module checks on Node22, 4/4, zero skips. This is not a formal GitHub approval. The dispatch requested Sol xhigh; runtime provider/model identity is not exposed in the receipts.

| Check | Exit | Result |
| --- | --- | --- |
| Candidate source gate, Node22.23.2 | 0 | 20/20, zero skips. |
| Exact canonical production modules in declared copied installed layout, with new portable tests | 1 | 3 pass / 1 intended failure. Setup-only import returned200 and persisted one operational person; expected403/zero. Gusto3 remained green. |
| Cumulative candidate modules in the same declared copied installed layout | 0 | 4/4, zero skips. |
| Remove selected installed hub, keeping source checkout available | 1 | `MODULE_NOT_FOUND` at the selected installed path; no source fallback. |
| Existing Staffology Docker admission contract, unchanged | 0 | 15/15, zero skips. |
| Three-file supplement clean apply and exact-byte comparison | 0 | All3 postimages match. Scoped diff whitespace check passed. |
| Supplement and reviewed V009 complete patch, both application orders | 0 | Clean application both ways; identical combined Docker/test/recovery postimages. |

`receipt.json` contains exact commands, working directories, exit statuses, TAP digests and claim boundaries. The two `*-copy-manifest.json` files list every declared production-module copy and its byte digests. `source-manifest.json` identifies remote preimages, postimages, donor patch identities and the independent review. Baseline test preimages were freshly fetched from exact PR537 and byte-compared; the canonical Docker preimage Git blob was recomputed and matched its freshly fetched `03ff80449601bd7bbbd8f28a7b6541515f18a4cd`. The complete canonical tree previously inspected by the integration owner contains no applicable AGENTS.md. Current inventory and owner coordination retain sole integration/release ownership.

The copied-layout runs materialize only relevant flat module COPY declarations and the three fixtures; they do not execute Docker, sealed archive composition, apt/npm installation, all existing image gates, a container UID boundary or hosted/customer workflows. No Docker or Podman binary is available. The runtime skill's environment-status capability and policy file were unavailable; no network bypass or Docker installation was attempted.

Two preparation attempts are recorded in `apply-receipt.json`: an unscoped diff check encountered existing donor-document whitespace, and initial text-mode patch serialization normalized CRLF. The final patch was regenerated as bytes, scoped to3 files and clean-applied with exact-byte comparison. No production behavior or assertion was weakened to obtain green results.

## Owner adoption and remaining gates

1. Inspect the exact PR537 source proposal and this three-file delta. Freeze current preimages; reconcile any newer owner changes before application.
2. Adopt PR537 once, then apply `image-admission-supplement.patch` once. Patch SHA256: `67f620cf095fcebe4b7a79373d16695b1783a3e58b4184e6cdfdb6610ee9bb0e`. Alternatively adopt the stacked exact source commit through the sole integrator after review. Do not apply the source donor patch twice.
3. V009 remains separate: the reviewed complete patch at PR528 commit `1f95c5a07a3bda2b4f765ec11d4134ebb63ff371`, SHA256 `8d3fbc19b54738a78261aa05d4226b510c98b054ffd0089ff40d2572b6376537`, composes in either order on these exact preimages. PR534 release-protection work also remains separate and requires its own reconciliation.
4. Rerun supported affected tests, full pinned image/archive/security/recovery admission, formal review and authorized intended-role hosted durable readback on the resulting exact candidate. A legitimate freeze renewal belongs to the final release composition; this supplement does not renew it or bypass the fail-closed PR534 gate.

Reproduction from retained files, using disposable output directories:

```sh
python3 run-proof.py --candidate /path/to/reviewed/stacked/checkout \
  --baseline /path/to/clean/61718/checkout \
  --node /path/to/node22/bin/node --out /tmp/vector-image-admission-proof
node --test integrations/staffology/independent/docker-admission-contract.test.cjs
```

V002/V007 remain TEST/INTEGRATION with an independently reviewed owner-ready admission supplement. Canonical adoption, complete image, deployed SHA, customer proof and readiness remain open. No merge, deployment, cloud configuration, protected policy, genuine credential, personnel, tenant or provider state changed.
