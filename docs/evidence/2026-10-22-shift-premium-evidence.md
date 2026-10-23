# Scoped shift-premium evidence — 2026-10-22

## Requirement and source

Issue #202 lists shift premiums as a Savings Engine opportunity and requires attribution-period and evidence discipline. This bounded package totals **declared planned shift-premium cost**, using the existing `operations/runtime/payroll-money.cjs` calculation and rounding. It is not a payroll run, realised cost or savings claim.

## Ownership and conflict

Open PR title/body searches for shift premium, premium cost and premium evidence, plus remote branch checks, found no focused owner. PR #494 owns shared payroll factor admission; #496 owns scheduler wage shape; #431 owns forecast labour cost. This package changes none of those files and passes only primitive factors to the existing money helper. Canonical implementation/integration/release ownership stays unchanged.

## Exact base and changed files

Base `48dce8f697825c8cd5f99b3e5aeea3953647f8c2`. Product files: `operations/runtime/shift-premium-evidence.cjs` and its test. This evidence record and the existing non-deploy admission trigger are also updated. No route, writer, scheduler, payroll ledger, frozen product artifact or deployment manifest is modified.

## Monetary-provenance repair

Independent review of predecessor `010a726cce4b276fb0f9dcbac4b282033f2cd996` found that pence lacked currency and that rate/multiplier values were not bound to immutable effective evidence. New regressions first failed because currency was absent from output and mixed/missing currency plus unchanged-identity monetary mutations were accepted.

The repaired assessor now requires one uppercase three-letter scope currency, emits it beside all pence, and requires each segment's hourly rate and premium multiplier to match effective-window evidence. Each evidence object carries tenant/site-scoped SHA-256 identity over its reference, validity window, currency and money-driving values. Missing/mixed currency, expired windows, digest mismatch, or reuse of one reference with a different digest fails closed. Outputs preserve each accepted reference and digest for downstream reconciliation.

## Result and tests

Fresh local Node execution:

- predecessor-compatible RED: 1/4 pass, 3/4 fail for the intended missing currency/provenance behavior;
- repaired focused suite: 4/4 pass, 0 fail/skip;
- `node --check` on source and focused test: exit 0.

The adjacent shared money helper is unchanged. Its previously recorded 16/16 suite and the predecessor operations 376/376 cannot be transferred to the successor; exact-head non-deploy admission remains required. Synthetic data only.

## Evidence-snapshot integrity repair

Formal exact-head review 5628139980 of predecessor 8ee4b40b9c836ac0c9b39361bdeecff34cb07358 reproduced a time-of-check/time-of-use gap: proxy-backed root, period and source envelopes could validate one timestamp and publish another. Hidden, Symbol, extra and custom-inherited evidence also remained outside the claimed receipt boundary.

Four committed regressions were added first and reproduced the blocker (**4/8 pass, 4/8 fail**). The bounded repair now rejects live/revoked proxies, custom prototypes and unsupported fields; requires exact enumerable own-data keys for the root, period, source, segment list, every segment, rate evidence and premium-policy evidence; and validates, calculates and publishes only values copied into one frozen snapshot.

Fresh Node v24.19.0 syntax checks passed. The committed suite and a separate held-out suite then passed **13/13**, covering proxies at every object/list boundary, revoked proxies, non-enumerable/Symbol/extra/inherited/accessor evidence, exact null-prototype envelopes, recursive output freezing and caller-mutation resistance. The held-out file is not part of the four-file package. Shared payroll-money.cjs remains byte-identical.

## State and next action

Built and focused-tested in isolation; fresh independent exact-head review, full operations admission, canonical integration, exact image proof, deployment and hosted/customer proof remain pending. `sourceAuthenticated:false`, `claimedSavingsPence:null` and `actionAuthority:false` remain unchanged. The canonical owner must authenticate WFM schedule/rate/policy evidence, reconcile PRs #494/#496/#431, verify tenant/site and payroll role controls in the existing FORGE path, then run exact merged-image gates and approved synthetic hosted readback. Production approval and customer-ready claims remain unchanged.
