# Scheduling shift-history shape admission — isolated handoff

## Requirement and source

Issue #202 requires hard consecutive-shift/night and fatigue constraints in scheduling. The existing scheduler's `normaliseWorker` converts malformed `consecutiveShifts` and `consecutiveNights` values to zero. That can remove a hard eligibility failure and lower the fatigue penalty. This package checks the structural shape of source shift-history counts before an adopting caller invokes the scheduler. It cannot establish whether the history is complete, fresh or source-authenticated.

## Ownership and exact base

On 2026-10-20, open PR searches for the exact count fields, fatigue evidence and malformed shift history, and remote branch searches for fatigue/consecutive/shift-history found no focused owner. PR #233 owns broad scheduling parity; PR #353 owns maximum shift duration. This package changes neither existing scheduling file nor shared service, creates no runner or writer, and leaves the sole canonical implementation, tenant, run and release owner intact. Other chats/jobs are not globally observable from this workspace.

- Base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Branch: `fix/vector-scheduling-history-evidence-20261020`.
- Changed files: `operations/runtime/scheduling-history-evidence.cjs`, its focused test, and this record.

## Result and verification

`assertSchedulingHistoryEvidence(workers)` is a pure preflight. It requires own finite safe integer counts from 0 to 100, rejects sparse/proxied/active records, and rejects consecutive nights greater than consecutive shifts. It does not modify input or introduce schedule/payroll authority. The 100 maximum matches the current engine's normalization ceiling; it is not a legal work limit.

- Baseline existing scheduling suite: 27/27 pass on Node 24.19.0.
- RED: the new test initially failed for missing guard module and demonstrates `consecutiveShifts: 'unknown'` becoming zero in the existing engine.
- GREEN: combined guard and scheduler suites pass 31/31 on Node 24.19.0 and supported Node 22.23.2 with a read-only source mount. `git diff --check` passes. No exact new-image or hosted test ran.
- Independent review passed 31/31 and malformed/edge held-outs. It reproduced that the current `evaluateOpenShift` still accepts both counts as `'unknown'`, with zero fatigue penalty, because this guard has no runtime caller. Review therefore accepts the isolated preflight only and does not approve runtime prevention.

## Status and next action

**TESTED isolated.** Not integrated, enabled, deployed, proven or customer-ready. The last read-only Railway check served `90ad90fcf60adaca9abacdd4ad14bf392f95e585` via deployment `057e19a2-7d49-4390-8705-63e71ea79a89`; the staged patch still targets base `48dce8f`, not this package. No tenant or Railway mutation occurred.

The canonical owner must reconcile this preflight with existing scheduler and source adapters, make current authenticated shift-history evidence available, update fixtures that omit counts, and wire admission before plan, open-shift, swap and repair eligibility paths. Then run independent exact-candidate Node 22/full-image/frozen hosted gates and synthetic customer proof on one serving SHA. Until wiring, malformed history can still be treated as zero by the runtime.
