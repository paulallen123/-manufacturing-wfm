# Scheduling — declared staffing during breaks

Status: **TESTED locally**; adjunct advisory, not scheduling parity or assignment clearance. Sole canonical integrator/release owner: **Continue customer proof**.

## Requirement/source and ownership

Accepted scheduling coverage/break-relief requirement: current VECTOR-full-recorded-backlog-20261013.md section3 explicitly lists “Explicit overtime authority; rest, fatigue, maximum shifts and break relief.” #265 v3/v4 are programme scope addenda, not evidence for a specific F-number. The reservation’s F1 shorthand is not a verified row ID and is corrected here; the requirement remains open as a whole. One bounded continuous declared-staffing assessment, not closure of whole break planning/pay policy/entitlement.

Reservation #265comment6150914108. Current open PRs, matching refs and recent ownership records show no narrow planned-break assessment; canonical `manufacturing-scheduling-engine.cjs` has no break/relief handling. Scheduler/forecast/transfer owners retain existing source and integration seams. This package adds disjoint new files only; hidden chats/unadvertised leases are not certifiable. No scheduling/absence/clocking/worker route, published shift, policy engine, shared runner/controller or existing Dockerfile changes.

## Exact base/files

- Canonical base48dce8f697825c8cd5f99b3e5aeea3953647f8c2, treecc8ff3737036dec8fe69a90e0759289661280537.
- Unchanged reused scheduler source blob97cbbc3405abfc010a6513aa67ab58d56e1079f8 and existing test blobee1c0b4e12d818b67e03bdf0dd6ae53624cdc2b8 fetched at that base and verified by git hash-object. Neither is in this change.
- New `operations/runtime/planned-break-coverage.cjs`, its `.test.cjs`, `.github/workflows/planned-break-coverage-gate.yml`, this evidence and independent review report.

## Implementation and design contract

`assessPlannedBreakCoverage({plan,breaks})` consumes the existing canonical shadow-plan shape (contractVersion, tenant, contextRevision, planId, sourceEvidence, validation, requirements, assignments). Reuse existing scheduler CONTRACT_VERSION/digest; do not invent another scheduler. Plan digest is only content consistency, never authentication.

Explicit `breaks:[]` declares no known breaks; a missing breaks field is INCOMPLETE. Each supplied receipt requires exact plan/tenant/contextRevision, canonical slot/worker/site, valid UTC start/end inside the assignment, opaque evidenceRef/revision. Same worker+source reference replay is idempotent; changed revision/content conflicts require reconciliation, never silent supersession. Receipts identify source claims and are not themselves trusted permissions.

Verify complete canonical slot identities, requirement counts, assignment times/site/line/role consistency, explicit unfilled slots, distinct workers and absence of simultaneous double assignment. Split each requirement on all relevant half-open break edges, then count distinct assigned workers available throughout each interval. Return exact shortages (required, available, shortfall and interval), or DECLARED_COVERAGE_COMPLETE_UNVERIFIED. Inputs are captured as immutable plain data; active objects fail closed without getters/proxy behavior. Outputs are detached immutable ordinary data.

Always `executionPermitted:false`, `customerReady:false`, claimBoundary DECLARED_STAFFING_ONLY_NOT_ASSIGNMENT_AUTHORITY. No actual attendance, skill truth, statutory break entitlement, fatigue/rest legality, break pay, relief eligibility, schedule publication or staffing-ready authority is established. The owner must authenticate current plan/break source and policy; this pure function does not replace those controls. Relief-worker selection is not implemented by this assessment.

## Actual tests and failures

- Initial RED: test loader failed exit1 because the new module did not exist (one failed test-file entry, no assertion cases executed). The synthetic fixture independently demonstrates current whole-shift quality100 while a declared operator break leaves coverage0.
- Initial implemented run: 7pass/1fail; expected public plain-object gap versus null-prototype output mismatch. Corrected generated output to detached frozen ordinary objects.
- Independent review found contradictory assignment.site accepted after recomputing plan digest. Added fail-first scoped-provenance regression: 11pass/1fail; corrected assignment requirement site/line/role and canonical sourceEvidence/validation checks.
- Final focused new suite13/13 plus unchanged scheduler27/27 in one combined Node24.19.0 run40/40, exit0, zero failures/skips/cancellations/todos. Counts are one run and must not be doubled.
- Source/test syntax checks pass. Dedicated supported Node22.23.2 workflow tests the new adjunct and unchanged scheduler, read-only token and pinned existing actions; no deploy step. Native full image, actual route/adapter integration, current policy/provider and hosted proof remain open.

## Review, integration and deployment

Independent review report is included separately with final hashes, actual commands and scope. No canonical integration, enabled runtime/API, exact-candidate full image, deployment or hosted/customer proof is claimed. Fresh observed live service remains historical90ad90fcf60adaca9abacdd4ad14bf392f95e585 at successful deploymentfaca24a2-10b9-4289-bc49-3406e44f7272; canonical48d is separate.

## Blockers/next action

Existing scheduler/source owner must accept an authoritative planned-break projection and current plan receipt, reconcile this read-only evaluator with the current scheduler once, decide whether to expose only a conservative staffing-gap advisory, run actual combined/native/full-image tests and controlled release, then prove authenticated declared break→coverage gap→authorised relief planning→fresh persisted plan/audit on one serving SHA. That later relief/policy/clearance journey remains unfinished; this package is only its deterministic coverage assessment. No provider/personnel/payroll/schedule writes, customer contact, paid infrastructure changes or persistent product worker were performed.
