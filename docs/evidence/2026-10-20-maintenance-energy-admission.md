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

## Status, blockers and next action

Built and locally tested; independent review, canonical integration, exact candidate image proof, deployment and hosted/customer proof pending. Source names/digests, work-order revision and workforce claims are supplied by the caller, not independently authenticated. The canonical owner must review the wrapper, reconcile PR #420 and the separate workforce/production maintenance packages, bind authenticated CMMS/energy/WFM evidence and role/site checks in the existing FORGE path, then run exact-candidate release and synthetic hosted proof. Production approval and customer-ready claims remain unchanged.
