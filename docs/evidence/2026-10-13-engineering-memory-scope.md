# F4.2 engineering-memory scoped search boundary

Status: **TESTED locally and independently reviewed.** This is an isolated adoption package stacked on the historical engineering-memory prototype, not part of the canonical release.

## Requirement and source

Accepted F4.2 in `VECTOR-Friday-release-backlog-2026-10-11.md` version 12 and [issue #202](https://github.com/paulallen123/-manufacturing-wfm/issues/202) require engineering document/drawing/BOM/routing intelligence grounded in revision provenance and permissions. [PR #205](https://github.com/paulallen123/-manufacturing-wfm/pull/205) provides an evidence-backed engineering-memory similarity prototype, but its own claim boundary leaves extraction, connectors, and customer proof open. This slice adds an explicit tenant/site and approved-record scoped query plus revision-lineage scope. It does not implement extraction or authentication.

## Ownership and exact base

Checked issue #202, open PR searches for engineering documents, memory, similarity and document ingestion, and engineering-memory/document-admission branch searches on 2026-10-13. Only historical PR #205 was found for this model; it was last updated 2026-09-21, with no active branch for this missing scope boundary or current writer found. This package is a child of its exact head `65fc59dadba377bce5fc68a88dc536261a5e68be`, not a competing edit to PR #205. Source blob `platform/factory-graph/engineering-memory.mjs` was `3c29817cc403cdbec9ae75b7fb8830a07de7b947`. The canonical release branch was separately verified still at `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`; the prototype is not in it. Continue customer proof remains the single canonical integration and release owner.

## Changed files and result

- `platform/factory-graph/engineering-memory.mjs`: adds `scopedSimilarTo` requiring a caller-supplied trusted tenant, site and approved-record ID set; filters both query and results before returning evidence references. Rejects partial tenant/site metadata and cross-scope revision parents when scoped records are supplied. Snapshots the first-level evidence fields on construction so caller sourceRef changes do not silently repoint published results. Legacy `similarTo` remains available to existing prototype consumers; the canonical owner must expose only the scoped path in authenticated customer routes.
- `platform/factory-graph/engineering-memory-scope.test.mjs`: synthetic same-scope allow, private record denial, cross-site/tenant denial, cross-scope revision refusal, legacy compatibility and caller-mutation regression.
- `docs/evidence/2026-10-13-engineering-memory-scope.md`: this record.

## Tests and review

Node v24.19.0: five-case focused suite first ran 4 pass/1 fail on caller-mutated sourceRef, then 5/5 pass after evidence snapshot. Existing `node scripts/validate-engineering-memory.mjs` passed with its original synthetic top match `drawing:B-r1`, score `0.9598`, revision lineage and missing-parent checks. Its generated JSON receipt has `source_sha:null`, `deployment_id:null`, `deployment_proven:false` and is only local source evidence. Independent review reran 5/5, checked the mutation reproduction and found no remaining critical/important scoped false acceptance or leakage. No supported Node22/exact-head CI, image, route, or hosted test has run.

## Integration, proof and next action

Not merged into PR #205 or the canonical candidate, not deployed/enabled, not hosted-proven or customer-ready. The caller-supplied allowlist is not an authentication mechanism; a trusted server route must derive it from actual document permissions. The prototype still permits unscoped `similarTo`, `recordById` and `records` calls; they must not be exposed to untrusted customer code. Deep arbitrary evidence metadata, source file parsing, revision digest/signature, extraction fidelity, real provider document custody, authorization and customer decision readback remain open. The canonical owner should reconcile PR #205 with this scoped change, bind records to authoritative tenant/site/document ACL and revision source, run exact combined tests on the approved candidate and complete release and hosted proof gates.
