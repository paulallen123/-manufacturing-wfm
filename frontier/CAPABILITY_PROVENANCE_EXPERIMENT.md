# Capability Provenance frontier experiment

## Novel connection
Connect authoritative manufacturing process genealogy to authoritative workforce competence evidence, then emit a privacy-minimised machine-verifiable statement that required competence coverage existed for a recorded process event without exposing the employee identity.

## Falsifiable hypothesis
For regulated/high-assurance manufacturing, a product/lot-linked competence attestation can reduce manual supplier/audit evidence work and improve release traceability without exposing direct employee PII or moving consequential authority into AI.

## Simple alternative
Keep MES product genealogy and WFM training/competence reports separate; auditors manually reconcile them when needed.

## Success threshold
1. Zero expired, revoked, wrong-site, wrong-tenant, wrong-skill or wrong-holder credentials may produce an attestation in synthetic/replay testing.
2. The emitted attestation must contain no direct employee identifiers.
3. The same contract must work for a one-person single-site manufacturer and a 10,000+ employee multi-site group without changing the decision semantics.
4. In customer-like replay, evidence assembly time must fall materially versus manual reconciliation while preserving auditability.

## Stop criterion
Reject or redesign if authoritative process-to-skill mappings cannot be sourced, if physical execution is inferred from competence alone, if privacy requires exposing employee identity, or if customer-like replay shows no material reduction in audit/release evidence effort.

## Safety / trust boundary
The engine confirms only that authoritative source records show a valid competence credential bound to a recorded process event at the execution time. It does not independently prove that the person physically performed the task, that the product conforms, or that the process was safe. External cryptographic signing/verification is a separate trust service and is not implemented in this experiment.

## Commercial value to test
Potentially lower supplier-qualification/audit administration, faster regulated release evidence assembly, stronger OEM/customer assurance, fewer manual joins between MES genealogy and workforce records, and a standards-aligned foundation for future product-passport ecosystems.

## Handoff if it survives
- Integration & Data Fabric: MES/genealogy/credential semantics and issuer trust.
- Product Evolution: audit/release presentation and customer-facing assurance UX.
- Trust/Proof/Release: cryptographic profile, revocation/status, privacy and replay proof.
- Frontier: retains discovery ownership and continues adjacent searches.
