# Exact-order staffing coverage shadow — 2026-10-24

## Requirement and source

Issue #202 requires real-time staffing risk by line, site and order. The existing `operations/runtime/manufacturing-scheduling-engine.cjs` produces a shadow plan and aggregate slot coverage. This bounded package binds the plan's slots to one **declared** production order, line, site and future window, then reports filled and gap slots. It does not publish a schedule, assign a worker, infer lost output or claim savings.

## Owner and conflict check

Open PR searches for order coverage, order staffing risk, staffing risk and line coverage, and remote branch checks, found no focused owner. Related PR #233 owns scheduling parity; production/output and staffing-break PRs own different slices. The canonical integration/release owner remains unchanged. This package creates no route, provider adapter, writer, runner, controller or deployment.

## Exact base and files

Base `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. New `operations/runtime/order-staffing-coverage.cjs`, `operations/runtime/order-staffing-coverage.test.cjs`, and this record. The final branch commit may also update `artifact/vector-proof-freeze.trigger` solely to request non-deploy CI.

## Implementation and verification

The assessor consumes the existing scheduler's shadow plan contract and checks its self-consistent `planId`, tenant, validation claim, creation time, and no-execution mode. A complete declared MES order source owns the exact order/site/line, window and requirement IDs. Each selected requirement must be inside the order window, and all expected scheduler slots must appear exactly once with matching site, line and time. A slot is filled only with a nonempty worker ID; otherwise it must be an explicit shortfall. Output contains counts and requirement IDs, not worker IDs, and keeps `sourceAuthenticated:false`, `actionAuthority:false`, `executionPermitted:false`.

Initial focused run: 0/4 because the scheduler serializes `createdAt` with `.000Z`; the assessor accepted only seconds. After aligning to the scheduler's actual timestamp shape, focused synthetic tests passed 4/4. Scope, source-binding and canonical slot-ID hardening also passed 4/4. Full operations runtime passed 377/377 on Node 24.19.0, local FORGE core reported `VECTOR_FORGE_CORE_CI=PASS`, and syntax/diff checks passed. CircleCI exact head, external image and hosted tests remain pending. No customer, payroll or tenant state was touched.

## Review, integration, deployment and proof

Built and locally tested, pending independent review and canonical integration. A matching `planId` only proves plan self-consistency; it does not authenticate MES orders, worker qualifications or source revisions. The canonical owner must bind authenticated current MES order-to-requirement evidence to the scheduler plan, reconcile with #233 and production risk work, enforce role/site access, and independently review the integrated candidate. Exact-image security/release gates and synthetic hosted readback on one serving SHA must precede any staging enablement. Production approval and customer-ready claims remain unchanged.
