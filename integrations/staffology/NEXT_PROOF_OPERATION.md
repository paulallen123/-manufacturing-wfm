# Exact next VECTOR-to-Staffology proof operation (not executed)

## Preconditions to verify and record

1. Reconcile the implementation commit onto branch `release/vector-customer-ready-candidate-20260925` at candidate `dedf7b307464c513f418bb7c95f37e53660b56a1`; do not substitute another target.
2. Independently verify deployment `eee54936-1565-4dec-a475-5c54b2f4b95e`, tenant `northstar-demo`, and implementation run `09c83c6c-ddc6-4ba7-b8aa-adaa5d80295e` are still bound together.
3. In Railway metadata (without displaying the value), verify `STAFFOLOGY_API_KEY` exists on service `fc72219b-ee7c-4b84-8d94-1a14cf7d6e78` in environment `eed9f097-610a-416e-83b9-6bc7bdb3eeef`, and verify the running process receives that same variable. A missing or different binding is a stop condition; do not add, rotate, remove, restart, or deploy under the current authority.
4. Obtain and hash the original `Staffology_payroll_proof_2026-09-30.md` and `Staffology_payroll_evidence_2026-09-30.zip`. Preserve them as prior provider-only evidence, not hosted VECTOR evidence.
5. Approve and review the release/configuration patch that wires this adapter to VECTOR's integration hub, employee import, payroll output, durable provider-receipt store, and reconciliation boundary. Run the full offline regression before deployment.

## Proposed separately authorised hosted proof

Use a newly approved, non-production Staffology payroll draft and named test employee; do **not** reuse or silently recreate the deleted draft. The operation must:

1. read all employee pages and stage the resulting `people` envelope;
2. verify employer and employee identity plus effective-date/source provenance before applying the import;
3. create exactly one uniquely identified payroll delivery from a reviewed VECTOR batch using a durable idempotency key;
4. capture the request digest, transport request ID, provider reference/revision, full relevant financial snapshot, and response digest while redacting credentials and personal data;
5. reconcile the provider state independently by employer, employee, payroll code, provider reference, and financial fields;
6. replace with identical input only if that write is explicitly included in the new approval, then compare complete snapshots field-by-field to diagnose the unresolved repeat discrepancy;
7. on timeout or connection loss, mark the delivery uncertain and reconcile by the same identity before considering any resend;
8. delete the temporary draft only if deletion is explicitly approved, then verify history/account/employee state and absence of payment requests against recorded pre-operation values.

## Precise next approval needed

Approve **only after the target and credential bindings above are verified**: (a) the reviewed adapter wiring/configuration release and deployment to the exact frozen application target, and (b) one bounded non-production hosted proof allowing the specifically named draft writes and cleanup. That approval must state whether an identical replacement write is allowed. It must continue to prohibit finalisation, HMRC submission, payments, emails, production/frozen-tenant mutation, and unbounded spend.

## Current gate: no release/test approval request yet

The preceding historical checklist is not an executable approved operation. Canonical store and authority integration is incomplete; the current draft window, exact employee scope, approved effective-dated mapping/rounding and complete financial expectations are not established. Dependency installation and Docker build gates must also complete. Do not deploy or execute provider requests from this preparation artifact. The canonical owner retains deployment-hook review and preparation of the separate exact operation approval.
