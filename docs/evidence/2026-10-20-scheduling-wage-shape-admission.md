# Scheduling wage shape admission — isolated handoff

## Requirement and source

Issue #202 requires truthful labour cost forecasting, overtime and agency decisions, and savings evidence. The canonical `manufacturing-scheduling-engine.cjs` currently uses `Number(...)` with defaults for worker cost inputs. For example, `hourlyCost: 'unknown'` becomes zero before an economic candidate is ranked. This package provides a fail-closed structural check for the wage operands that influence that ranking. It does not authenticate a payroll source or grant payroll authority.

## Ownership and conflict check

The sole canonical implementation, tenant, run and release owner is unchanged. On 2026-10-20, open PR title/body searches for `hourlyCost`, invalid worker cost, scheduling cost coercion and shift premium found no focused owner. Remote branch searches for `hourly`, `cost` and `economic` found existing payroll, forecast, maintenance and energy branches, but no malformed scheduling wage admission branch. PR #233 owns broad scheduling parity and PR #431 owns forecast labour cost; this package edits neither of their files. Visible local agents had no work on this item before selection. Other chats/jobs are not globally observable from this workspace, so the claim is bounded to the inspected state.

## Exact package

- Base: `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`.
- Branch: `fix/vector-scheduling-economic-evidence-20261020`.
- Changed files: `operations/runtime/scheduling-wage-evidence.cjs`, its focused test, and this evidence record.
- Pure `assertSchedulingWageEvidence(workers)` checks own worker records, unique nonblank IDs, numeric wage, hours and multiplier inputs, and applicable agency/contingent premiums. It rejects missing, coerced, nonfinite, negative and extreme values before an adopting caller invokes the existing scheduler. Limits are conservative technical safety ceilings (168 hours, 1,000,000 currency units per hour, multiplier 100), not policy or legal rates. No route, service, scheduler, writer, runner, provider call or tenant data is changed.

## Test and review evidence

- Baseline canonical scheduling engine: 27/27 passed on Node 24.19.0.
- RED: new test initially failed because the guard module did not exist. The test also reproduces the current engine converting `hourlyCost: 'unknown'` to zero. Independent review then found a finite overflow case (`1e308`) and no runtime wiring. Overflow and accepted lower-case worker type regressions failed before correction.
- GREEN: guard plus existing scheduler suites passed 32/32 on Node 24.19.0 and supported Node 22.23.2 (the latter using a read-only mounted source in the prior sealed image). `git diff --check` passed. No full-image or hosted test ran for this package.
- Independent review: first review found the overflow hole and confirmed that the guard is isolated rather than enforced by runtime entry points. Re-review found no remaining actionable guard defect, separately passed 32/32 focused tests and rejected 11 malformed held-outs. It explicitly did not approve runtime enforcement or release.

## Status and next action

**TESTED isolated** after review. It is not integrated, deployed, enabled, proven or customer-ready. In the last read-only Railway check the existing customer-ready service was still serving `90ad90fcf60adaca9abacdd4ad14bf392f95e585` via deployment `057e19a2-7d49-4390-8705-63e71ea79a89`; staged patch `b453aa80-4763-4a08-a4f5-d5d27534b2c8` still targets base `48dce8f`, not this package. No Railway or `northstar-demo` mutation occurred.

The canonical owner should reconcile this guard with the current scheduling and source-adapter work, decide where authenticated wage evidence enters, wire admission before all economic ranking paths, and update upstream fixtures/contracts without silently defaulting missing source values. Then run the exact combined Node 22 and full-image gates, independent review, frozen release admission, and synthetic hosted/customer proof on one serving SHA. The guard does not cover travel cost evidence or validate source authenticity; those remain separate requirements. Until wiring and proof, the current runtime can still rank malformed wages.
