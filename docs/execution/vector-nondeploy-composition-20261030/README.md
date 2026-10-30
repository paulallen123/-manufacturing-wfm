# Exact non-deploy proof composition — 2026-10-30

This isolated candidate composes reviewed recovery and CI changes on PR539 `dae48f82680635f6b5e94995ac2dc2a543c2f1b4`. It retains PR537 `521affbc019fb2ef48b1e3740401613b16bf408a` once and leaves canonical PR501 `61718e1862fa650136e1952f622c9d8dd4c22af8` untouched. Sole canonical integration/release ownership remains with the existing owner.

The primary writer `/root/proof_gate_composition` owns only this isolated candidate; `/root/proof_gate_verifier` independently reviewed and tested read-only. Latest visible #527 entries and donor owners showed no competing writer/lease on these files. External chat liveness is not globally observable. No AGENTS.md exists in the complete inspected PR539 tree. Requested worker variant was Sol xhigh; runtime model identity is not exposed by these receipts.

## Composition and custody

All1,676 baseline blobs were materialized and verified against fresh PR539 Git tree `95a8183e1b219011a67216643c4ffd2d3fa430b9`. The local Git baseline is a synthetic commit of that identical tree; it is not represented as the remote parent. Remote publication must parent actual `dae48f82680635f6b5e94995ac2dc2a543c2f1b4` and retain every untouched tree entry.

Clean patch order:

1. Exact V009 complete patch from PR528 documentation commit `1f95c5a07a3bda2b4f765ec11d4134ebb63ff371`; SHA256 `8d3fbc19b54738a78261aa05d4226b510c98b054ffd0089ff40d2572b6376537`. Adds useful fail-closed recovery help and mandatory source/installed admission. Runtime SHA256 remains the previously reviewed `a7211fe3f6ad85f94be2d469eccd0adc6d2e5613c17fe2439d16bc697fa4463e`.
2. PR534 `8cace91e816f3c42c29abd0b4540cc799ac03c2b`, the existing three-file fail-closed proof admission repair.
3. PR538 `892609622ace380969da46c7c47bd3a6ab79fd4d`, ordinary integration source CI delta. Final CircleCI config is byte-identical to that donor, blob `a70b04440189706c1e6b9afbd8fd041fb382c33c`.

All donor postimages matched freshly fetched exact source bytes. V009 was independently replayed on exact539 preimages; all3 outputs matched. The six-entry `source-inventory.canonical.json` is UTF-8 compact JSON, keys sorted, entries sorted by path, no trailing newline. Its SHA256 is `122e4b6166187e8be82f6986f6bccea4844ab05fe88d64ad4910ba07d3ea93eb`. `composed-source.patch` SHA256 is `079ba54c0559dcb784c12f814f7491d96ee046c2426fc4096aa06c5bb926b8ba`; it cleanly represents all6 source/config changes against539 without the freeze renewal or evidence packet. Apply it once only on the frozen539 preimages.

The authentic freeze marker's complete9,104-byte prefix, blob `79fa5e8eb3048f604482c813cdf8954f35b829c2`, is preserved. One appended renewal record binds parent539, canonical501, the donor inventory, these source digests, eligible branch `feature/vector-reviewed-nondeploy-proof-20261030` and a cold exact-CIRCLE_SHA1 non-deploy proof requirement. The record preserves the full existing source/image/archive/security/recovery scope. Independent technical review found no material in-scope issue; this is not formal GitHub approval.

## Fresh local evidence

| Check | Runtime | Exit/result |
| --- | --- | --- |
| Primary affected source suites | Node22.23.2 |0;45/45,zero skips |
| Independent affected suites, including advisory helpers | Node22.23.2 |0;61/61,zero skips |
| Unchanged complete `scripts/run-forge-ci.mjs` | Node22.23.2 |0;all16 commands,225/225 TAP,zero skips;`VECTOR_FORGE_CORE_CI=PASS` |
| Exact composed modules in declared copied installed layout, V014/V088 | Node22.23.2 |0;4/4,zero skips |
| Missing selected installed integration module | Node22.23.2 |1 expected;MODULE_NOT_FOUND at selected installed path;no source fallback |
| Exact composed recovery module in copied installed layout | Node22.23.2 |0;4/4,zero skips |

Counts overlap and must not be summed as unique coverage. Full source execution used local-only `TAR_OPTIONS=--no-same-owner` because the managed root namespace cannot restore archive ownership. CI configuration was not changed for this preparation. No Docker/Podman or CircleCI CLI is installed; copied layouts are not image builds. Authoritative CI image/runtime results require exact final-commit platform evidence.

The six source/config files pass `git diff --check`. The retained patch artifact intentionally preserves CRLF context and blank patch context lines; an unscoped whitespace check flags those embedded patch bytes. They are not reformatted. The remaining source/marker/evidence files pass the scoped whitespace check.

Preparation notes are retained in receipts: GitHub PR534 per-file hunks required explicit new-file metadata before clean application; final content matched all donor bytes. An initial manifest omitted untracked additions and was corrected to all6 files. Two exploratory installed-baseline paths were unsuitable (one absent, one already repaired); neither is claimed as canonical red evidence. The final installed green/missing-module checks above use the exact composition. Independent baseline negatives were separately reproduced by the reviewer.

## CI and remaining boundaries

Publish this composition, marker and evidence in one commit on the isolated eligible branch. No later evidence-only commit may be added without another legitimate renewal: the gate correctly refuses an unchanged marker relative to the immediate parent. Record final commit/tree, raw seven-file product/config/marker readback, source parent and exact-SHA statuses outside the frozen tree. Old donor CI statuses do not transfer.

The existing CircleCI workflow has ordinary source validation, frozen core validation, and runtime validation dependent on core. Preserve it exactly. Runtime proof builds the existing Docker/archive targets and checks the existing isolated container security/HTTP/UID/source bindings. This is non-deploy CI proof only. A status can establish only the status reported for its exact commit; unavailable full logs/artifacts leave per-step counts/image digests/runtime proof unverified.

No canonical adoption, merge, Railway/customer/provider deployment, genuine credential access, tenant/personnel/provider write, branch-policy administration, formal approval, customer acceptance or readiness is claimed. V009 access ceremonies and the full145-lane customer backlog remain open under the existing owners.
