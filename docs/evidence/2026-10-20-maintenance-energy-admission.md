# Maintenance energy-window admission — 2026-10-20

## Requirement and source

Issue #202 accepts maintenance scheduling around workforce, production and energy constraints. The manufacturing asset decision/value OS design calls for composing existing energy and maintenance engines. The existing `src/frontier/energy-flexibility.mjs` accepts `maintenance_swap` but has no work-order binding. This bounded wrapper validates that binding, then reuses that engine. It is an advisory candidate only.

## Ownership and conflict

Open PR title/body searches for maintenance energy windows, tariff and energy-aware maintenance, plus remote branch searches, found no focused owner. PR #420 owns confidence hardening inside the energy engine, and #394/#477 own maintenance workforce/production slices. This package changes none of those files. The existing canonical implementation/integration owner retains adoption, source binding and release authority.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. New files: `src/frontier/maintenance-energy-admission.mjs`, its test, and this evidence record. No route, writer, controller or deployment is added; the energy engine remains unchanged.

## Implementation and tests

The wrapper requires exact tenant/site/asset/work-order ID and revision, an open source-owned work order, fresh observation, permitted maintenance interval, active fresh energy signal that spans the proposed interval, explicit workforce evidence and approval requirement. It calls the existing energy engine for the final constraint/value decision. Its output is `ADVISORY` or `BLOCKED`, always with `sourceAuthenticated:false` and `actionAuthority:false`; it claims no realised saving, qualification or approved schedule mutation.

TDD began with the expected missing-module failure. The first positive/adversarial/engine tests passed 3/3. Additional stale and missing-evidence regressions failed before correction, then the focused and adjacent energy suite passed 16/16 on Node 24.19.0, including existing 1,500-scenario and 500-replay tests. The broader frontier suite passed 399 tests with 67 existing skips and zero failures; local FORGE core gate passed. Final external CI results are recorded in the PR. Synthetic data only.

## 2026-10-23 blocking-review repair

Independent review of predecessor head `7b0ec292ffeb1c233715e4635359a5ba6e911569` identified two fail-open paths: malformed confidence could be normalized to full confidence by the unchanged shared engine, and same-site process evidence was not bound to the maintained asset/work order. The wrapper now requires finite numeric confidence in `[0,1]` for the energy signal, process and workforce, and requires process asset/work-order/revision binding plus source metadata, a positive process revision and a non-future observation no more than 15 minutes old. Existing broad engine code remains unchanged.

Fail-first command `node --test src/frontier/maintenance-energy-admission.test.mjs` produced 3 passes and 2 failures: both new regressions observed `ADVISORY` instead of `BLOCKED`. After the wrapper repair, `node --check src/frontier/maintenance-energy-admission.mjs && node --test src/frontier/maintenance-energy-admission.test.mjs && git diff --check` completed with 5/5 tests passing, zero failures, zero skips on Node 24.19.0. The matrix covers 15 malformed/non-finite/out-of-range confidence cases and nine foreign, drifted, incomplete, future or stale process-evidence cases; the existing mutation table now asserts exact blocker reasons. Separate standards and requirement reviews of the fixed-point diff reported no findings. These are isolated source/test results, not Node 22 hosted proof, integration, deployment or customer proof.

## Status, blockers and next action

Built and tested in isolation; canonical integration, exact candidate image proof, deployment and hosted/customer proof remain pending. Source names/digests, work-order revision and workforce claims are supplied by the caller, not independently authenticated. The canonical owner must reconcile this wrapper with PR #420 and the separate workforce/production maintenance packages, bind authenticated CMMS/energy/WFM evidence and role/site checks in the existing FORGE path, then run exact-candidate release and synthetic hosted proof. Production approval and customer-ready claims remain unchanged.
