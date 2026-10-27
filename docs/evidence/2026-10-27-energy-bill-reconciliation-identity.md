# Exact energy bill reconciliation identity — 2026-10-27

## Requirement and source

Issue #202 calls for energy/tariff savings opportunities with evidence and realised-value discipline; issue #196 requires verified energy cost reduction. Existing `src/frontier/energy-bill-evidence.mjs` prices a meter bill and can mark it finance-reconciled. Before this repair, `reconcileEnergyBill` compared a ledger amount without checking its tenant, site or meter-point identity, and converted malformed invoice/ledger values with `Number(...)`. A foreign ledger could therefore yield `financeReconciled:true` and `exactSpendClaimAllowed:true`.

## Owner/conflict check

Open PR title/body searches for energy bill, energy invoice, ledger identity, finance reconciliation and the exact source filename, plus remote branch checks, found no focused owner. The adjacent `energy-data-reconciliation.mjs` already checks tenant/site and nonnegative amounts but has a different tariff and pricing contract; this package repairs the exact meter bill path in place. Canonical integration/release ownership remains unchanged. No new route, provider, writer, runner, controller or deployment configuration is created.

## Exact base and files

Base `release/vector-customer-ready-candidate-20260925@48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Changed `src/frontier/energy-bill-evidence.mjs`, `test/frontier/energy-bill-evidence.test.mjs`, and this record. The final commit may update `artifact/vector-proof-freeze.trigger` solely for non-deploy exact-head CI.

## Implementation and verification

An explicit ledger must match the tariff/invoice tenant, site and meter point before financial reconciliation. Invoice and ledger amounts must be finite nonnegative numeric values; null, strings, NaN and infinity are rejected rather than coerced. Caller-supplied GBP tolerance must be numeric, finite, nonnegative and at most £0.01. A missing, reversed or calendar-rolled billing period cannot omit standing charges from exact-spend admission. Coverage must bind the same tenant/site/meter with a literal boolean completeness claim and positive integer expected interval count. An omitted ledger may still support the existing invoice-only exact-spend result, but cannot set `financeReconciled`. The existing price and evidence-hash path remains unchanged.

TDD regression was red at 8/10: foreign ledger reconciled and malformed amounts did not return the required fail-closed state. Period and coverage regressions were red at 10/11 and 11/12: missing billing period and foreign/coerced coverage could yield `reconciled`. Corrected focused suite passed 12/12 and related energy suites passed 55/55 on Node 24.19.0. Local FORGE core reported `VECTOR_FORGE_CORE_CI=PASS`; syntax and diff checks passed. CircleCI exact head, image and hosted tests remain pending. Synthetic bill/ledger data only; no customer, finance, payroll or tenant mutation.

## Review, integration, deployment and proof

Built and locally tested; independent review and canonical integration remain pending. The ledger model still lacks an invoice ID or posted-entry provenance, and caller-supplied tariff, meter, invoice and ledger evidence is not authenticated by this repair. The canonical owner should review this changed finance claim boundary, reconcile the adjacent energy engine, bind a real exact invoice/ledger identity and trusted source adapters, then run exact merged-image security/release gates and synthetic hosted readback on one serving SHA. Production approval and customer-ready claims remain unchanged.
