# Realtime role audience boundary — isolated package

## Requirement and authority

- Backlog F1.10 and issue #265 require fresh role and tenant denial proof on the exact release. An unrecognised persisted role must not receive manager or all-audience realtime events after role change.
- Canonical owner: Continue customer proof. This package does not operate a writer, runner, controller or deployment. Open PRs and latest issue #265/#288 handoffs inspected on 13 October 2026 did not identify an owner for `operations/runtime/realtime-event-service.cjs` role matching. The last canonical edit to that file was 12 October's scheduling scope change.
- Exact base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`, tree `cc8ff3737036dec8fe69a90e0759289661280537`.

## Changed files and result

- `operations/runtime/realtime-event-service.cjs`: fail closed for unknown roles before any audience match. Preserve employee, manager, director, supervisor, company-admin, payroll_admin, admin, superuser, operations and finance role behavior. The final two are product experience roles; persisted `users.role` membership remains to be confirmed at integration.
- `operations/runtime/realtime-event-service.test.cjs`: check unknown role denial and recognised role compatibility, plus a tenant event polling path.
- `.github/workflows/realtime-role-audience-gate.yml`: Node 22.23.2 focused suite, syntax and Docker candidate build.

## Executed evidence

- Before the change, `node operations/runtime/realtime-event-service.test.cjs` was **2 pass / 1 fail**: `revoked` received manager audience.
- After the change, the same command was **3 pass / 0 fail** on local Node v24.19.0.
- Compatibility challenge: adding `operations` and `finance` to the recognised-role assertion was **2 pass / 1 fail** before extending the set, then **3 pass / 0 fail** after it.
- `node --check` passed for the service and test file. A complete canonical checkout, Node 22.23.2 execution, Docker build and hosted role revocation journey have not yet been run for the final PR head.
- Independent read-only review found no Critical or Important defect in the bounded guard, but flagged that canonical persisted role definitions and the full checkout were unavailable to that reviewer. The compatibility challenge above addresses the known product experience roles; exact runtime role mapping remains an integration check.

## Admission boundary

**TESTED locally**, not integrated, deployed, enabled, proven or customer-ready. The canonical owner must review the precise diff against the persisted role vocabulary, run the Node 22 and candidate build gate, adopt it into one canonical version, deploy through existing approval controls, and execute authenticated unknown/revoked-role denial plus retained-role readback against the same serving image. The live customer service was separately read at deployment `faca24a2-10b9-4289-bc49-3406e44f7272` from source `90ad90fcf60adaca9abacdd4ad14bf392f95e585`; the staged 48dc configuration patch had not been accepted at this inspection.
