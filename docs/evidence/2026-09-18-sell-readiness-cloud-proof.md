# Manufacturing WFM sell-readiness cloud proof — 2026-09-18/19

## Candidate and claim discipline

Target feature branch: `feature/one-day-enterprise-implementation-v1`.

Exact deployed source commit for the final cross-service proof: `510c1f71494572c8df5bb2c11feeac59ba7173e5`.

This commit is an evidence-only descendant of functional candidate `7bcc7f3cf4b4f9798349eb7cf51d2f330c9ee8fa`; no application code changed between those two commits.

Railway private-GitHub access is restored. Both pre-existing proof services fetched the exact feature-branch commit above. No replacement service, database, volume, environment or paid infrastructure was created.

All proof remains fail-closed. Hosted runtime identifies itself as `Fixture/demo data only. Production approved: false.` The eight-hour implementation timing model identifies itself as `SYNTHETIC_THEORY_ONLY`. Neither is accepted as evidence of a live provider connection or a real customer production implementation.

## Exact-current-head Railway proof — wfm-one-day-enterprise-v1

Existing service: `wfm-one-day-enterprise-v1`.

Deployment: `b4dbd4b7-8af2-466a-aa4b-1093e1e1d1d2`.

Source commit: `510c1f71494572c8df5bb2c11feeac59ba7173e5`.

Status: `SUCCESS`.

Runtime: listening on `0.0.0.0:3000`; public origin `https://wfm-one-day-enterprise-v1-production.up.railway.app`; runtime explicitly states `Fixture/demo data only. Production approved: false.`

The immediately preceding functional deployment at `7bcc7f3cf4b4f9798349eb7cf51d2f330c9ee8fa` ran the full current functional Docker admission gate successfully. The evidence-only `510c1f...` commit did not change application code.

## Exact-current-head Railway proof — wfm-integration-fabric-v1-proof

Existing service: `wfm-integration-fabric-v1-proof`.

Deployment: `f80565e8-b99e-41a9-b29d-bd1865f3b3b4`.

Source commit: `510c1f71494572c8df5bb2c11feeac59ba7173e5`.

Status: `SUCCESS`.

Runtime: listening on `0.0.0.0:3000`; public origin `https://wfm-integration-fabric-v1-proof-production.up.railway.app`; runtime explicitly states `Fixture/demo data only. Production approved: false.`

Admission/regression gate on this exact commit: `66` tests passed, `0` failed.

The strict T0-T4 autonomy admission stage remained present and fail-closed, requiring PASS, strict runtime, and no production/customer mutation before the hosted image can be admitted.

The gate covers implementation readiness, signed-contract invitation behaviour, tenant/recipient binding, role mastery, append-only evidence, autonomous integration controls, OAuth/PKCE and credential protections, safe source discovery, schema-drift handling, tenant isolation, workforce lifecycle controls and hosted listener safety.

Lifecycle edge matrix covers overnight and duplicate/post-leaver clocking, absence boundaries, explicitly approved overtime with no direct payroll mutation, bounded agency assignments, starter/transfer/leaver effective dating, retro changes preserving original evidence, integration outage/recovery checkpoints, idempotency and tenant isolation.

Role-learning controls cover least-privilege curricula, automatic role plans, independent competence evidence, teach-back, contextual refreshers, delta learning and tenant-isolated analytics.

Integration-security controls cover signed OAuth state, PKCE S256, server-side secrets, token/error redaction, least-privilege provider gating, same-origin pagination, malicious next-link rejection, trusted-worker authorization attestation and metadata-only discovery behaviour. These are harness/control proofs, not a claim that an external provider is live.

The hosted build preserves the role-first UX through Cycle 12, the adaptive coach and the Version D implementation journey.

## Exact cloud scale and payroll reconciliation — current head

Proof: `wfm-cloud-scale-implementation-and-payroll-reconciliation`.

Status: `PASS`.

Scale: 10,000 employees, 50 sites, 100,000 punches, 40,000 timecards, 1,750 cohorts.

Independent deterministic payroll reconciliation: expected `15,180,000`; projected `15,180,000`; unexplained variance `0`; variance count `0`.

Deliberate corruption control: projected `15,180,020`; unexplained variance `20`; exactly one variance detected (`E03087|P2`).

Hostile-data controls detected duplicate employee IDs, an orphan manager, missing organisational structure and a malformed punch and blocked unsafe auto-application. Payroll-sensitive overtime policy remained protected from silent auto-application.

The proof runner states the boundary explicitly: this is exact-candidate cloud execution, scale behaviour and fail-closed data handling using an independent deterministic payroll reconciliation harness. It is not evidence of a live payroll/HCM/ERP provider or a customer production implementation.

## Frozen customer-proof release

`wfm-customer-proof-0676` remains untouched. Its latest deployment is still the pre-existing successful deployment `a1d4693c-9c0c-42e9-8b64-4da66503d1be`, created 2026-09-18 00:11 UTC.

## Cleared blocker

The earlier exact-source provenance blocker is cleared: both requested existing Railway services now have successful deployments from the same exact feature-branch commit `510c1f71494572c8df5bb2c11feeac59ba7173e5`.

## Remaining hard proof boundaries

1. A genuinely authorised external-provider sandbox/test API. No provider may be described as live while only fixture/harness evidence exists.
2. Real zero-human customer environment provisioning/implementation evidence. The eight-hour simulation is architecture timing evidence only.
3. Complete authenticated role-by-role browser journeys through the hosted new role-first UI. The repository's staging-browser proof remains deliberately security-held until reviewed ephemeral authentication and pinned browser tooling criteria are satisfied.

Readiness flags remain unchanged until these boundaries are genuinely cleared.

## Reproducibility and safety

Primary evidence sources are Railway deployment/build logs for `b4dbd4b7-8af2-466a-aa4b-1093e1e1d1d2` and `f80565e8-b99e-41a9-b29d-bd1865f3b3b4`, plus Git source identity `510c1f71494572c8df5bb2c11feeac59ba7173e5`.

No new Railway resource or paid infrastructure was created. No production/customer mutation was performed. Security controls and readiness gates were not weakened to obtain a pass.
