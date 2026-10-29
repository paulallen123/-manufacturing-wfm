# Exact-order material availability evidence — 2026-10-26

## Requirement and source

Issue #202 lists inventory/material constraints in the Savings Engine and calls for a shared order/material/risk model. Draft PR #486 assesses one material requirement against a supply observation for timing; this package checks whether a **complete declared BOM and allocatable inventory snapshot** cover every required component for one exact production order. It does not infer production delay, purchase need, cost, savings or an action.

## Owner and conflict check

Open PR title/body searches for stockout, material availability, inventory availability, BOM coverage and material shortage, plus remote branch/path checks, found no focused whole-order availability owner. PR #486 owns a one-material delay receipt, and broad event/integration PRs have distinct scope. Canonical integration/release ownership remains unchanged. This branch creates no provider adapter, route, writer, runner, controller or deployment.

## Exact base and files

Base `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. New `operations/runtime/order-material-availability.cjs`, its `.test.cjs`, and this record. The final commit may update `artifact/vector-proof-freeze.trigger` solely for non-deploy CI.

## Implementation and tests

The read-only assessor binds tenant/site/order, complete effective BOM revision and digest, and a complete matching inventory revision observed after the BOM and within 15 minutes of caller-declared `asOf`. Each distinct BOM component must have one balance with the same unit, bounded integer milliunits and distinct evidence. Missing, extra or duplicated components block assessment. Output lists only per-component missing milliunits and both evidence references and digests; quantities of different units are never summed. `sourceAuthenticated:false`, `actionAuthority:false`, `claimedSavingsPence:null` remain explicit.

TDD missing-module test failed as expected. Focused synthetic tests passed 4/4 and full operations runtime passed 377/377 on Node 24.19.0, including a rerun after output provenance hardening. Local FORGE core reported `VECTOR_FORGE_CORE_CI=PASS`; syntax and diff checks passed. CircleCI exact head, external image and hosted tests remain pending. No customer, inventory, purchase or payroll mutation occurred.

## Review, integration, deployment and proof

Built and locally tested; independent review and canonical integration remain pending. Completeness, allocation net of reservations, quantity, order binding, effective dates and clock are caller claims. The canonical owner must authenticate current MES BOM and ERP inventory revisions, ensure allocatable stock cannot be counted for multiple orders, reconcile PR #486 and existing capacity decisions, enforce site/role access, then pass exact integrated-image security/release gates and synthetic hosted readback on one serving SHA. Production approval and customer-ready claims remain unchanged.
