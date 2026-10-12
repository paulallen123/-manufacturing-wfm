# Capability retirement evidence

The capability-superset validator permits a `superset-proven` retirement decision only when each entry in `proofRequiredToRetire` has exactly one receipt descriptor in `proofReceipts`. A descriptor contains `proofType`, `evidencePath`, and `evidenceSha256`. Evidence paths must remain under `release/retirement-evidence/` as regular JSON files.

Each evidence file must name the exact `capabilityId` and `proofType`, have `status: "PASS"`, a nonempty `evidenceRef`, the current 40-character source SHA, the exact `sha256:` image digest, and valid `observedAt`/`expiresAt` timestamps. The validator consumes `VECTOR_CANDIDATE_SOURCE_SHA`, `VECTOR_CANDIDATE_IMAGE_DIGEST`, and the current clock. `VECTOR_PROOF_NOW` exists for deterministic isolated tests and must be set by a trusted release runner if used in admission.

Matching local receipt bytes demonstrate binding and freshness, not independent authorship or customer proof. A party who controls both the manifest and evidence files can manufacture matching hashes. The release owner must separately verify receipt provenance and independent proof admission, then rerun the validator against the exact final image before retiring legacy source.
