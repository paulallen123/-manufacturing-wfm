# Manufacturing WFM sell-readiness evidence — 2026-09-18 22:53 BST

This evidence record is intentionally isolated from the feature branch and frozen customer-proof release. It records observed results only and does not change readiness flags, security controls, infrastructure or customer data.

## Candidate/source provenance

- Private repository access: `paulallen123/-manufacturing-wfm` is readable through the authorised GitHub connection.
- Current feature head: `6b85575090ed5591d2f9acc3caf0d1653804da53` on `feature/one-day-enterprise-implementation-v1`.
- Railway `wfm-integration-fabric-v1-proof` remains green on functional candidate `6d391d319c378c60ac38cfa27540afee1f81cb1a`.
- Railway `wfm-one-day-enterprise-v1` remains green on older commit `9aff595bebaedd9bf77c84d93753f9de9fac6e89`; exact-current-head provenance on that service is therefore NOT proven.

## Real Railway cloud evidence

Authoritative deployment reviewed: `8105241e-1f82-4317-8b4a-4d392730f833` on `wfm-integration-fabric-v1-proof`.

Observed build/runtime evidence:

- 63 tests executed, 63 passed, 0 failed.
- Strict T0–T4 autonomy admission gate passed in the image build.
- Cloud scale proof passed with 10,000 employees, 50 sites, 100,000 punches and 40,000 timecards.
- Independent deterministic payroll reconciliation: expected `15,180,000`, calculated `15,180,000`, unexplained variance `0`.
- Deliberate corruption: calculated `15,180,020`, detected unexplained variance `20`, one variance record.
- Hostile-data proof detected duplicate employee IDs, orphan managers, missing structure and malformed punches, and blocked unsafe auto-apply.
- Lifecycle tests cover overnight/duplicate/post-leaver clocking, absence boundaries, explicitly approved overtime override, bounded agency assignments, effective-dated starter/transfer/leaver events, retro changes preserving original evidence, and integration outage/recovery checkpoints.
- Tenant isolation, append-only evidence, credential-reference controls, PKCE/signed-state controls, malicious pagination rejection, schema-drift handling, role-based learning/mastery and teach-back controls passed their deterministic gates.
- Cycle 12 role-first UX and adaptive coach assets were composed into the hosted image.
- Railway `/api/health` healthcheck succeeded.
- Runtime explicitly reported: `Fixture/demo data only. Production approved: false.`

## Claim boundaries

The eight-hour implementation timing result in the build is labelled `SYNTHETIC_THEORY_ONLY`; it is architecture timing simulation, not customer implementation or live provider evidence. It must not be used as proof of a zero-human real customer implementation.

The cloud-scale runner explicitly states that it does not prove a live payroll/HCM/ERP provider connection or a customer production implementation.

Cycle 12/adaptive-coach asset composition proves the UI is in the hosted image; it does not by itself prove complete authenticated role-by-role browser journeys.

## Current blockers reproduced in this run

### Exact candidate deployment / CI execution

GitHub Actions run `35394464863`, attempt 2, exact head `6b85575090ed5591d2f9acc3caf0d1653804da53`:

- job `prove-and-deploy` (`105774535247`) completed failure in approximately one second;
- `steps` was empty;
- `runner_id` was `0` and `runner_name` was empty;
- no workflow step executed, therefore no product gate or Railway deployment was attempted by that run.

A rerun of the separate deterministic proof also failed before workflow steps executed. GitHub's public status page showed Actions operational at the time, so no specific global GitHub outage is being claimed.

Railway's available AI management route for an exact-commit deploy returned `Agent usage limit reached`. A normal Railway redeploy was deliberately not substituted because Railway documents that redeploy reuses the existing commit rather than fetching a new GitHub commit.

### Live provider evidence

Variable-name inspection of the existing `wfm-integration-fabric-v1-proof`, `wfm-one-day-enterprise-v1`, staging runtime and browser-proof services shows no configured provider-specific client/token variable names for Entra, Okta, Google Workspace, NetSuite, SAP, HCM or payroll providers. Existing tests therefore remain fixture/test-harness evidence; no provider is claimed live.

### Browser journeys

The existing browser-proof/runtime services expose WFM staging authentication variables, but this run has no browser execution channel capable of establishing the full authenticated role-by-role journey. No browser-journey completion claim is made.

## Sell-readiness status

**CONDITIONAL — unchanged.**

The functional candidate has strong real-cloud scale, payroll-reconciliation, edge-case, autonomy, tenant-isolation, security and learning evidence. Full sell-readiness remains blocked on:

1. exact-current-candidate provenance on the existing one-day service;
2. real authorised provider sandbox/test-API proof where credentials/access exist;
3. complete authenticated role-by-role browser journeys through the new UI;
4. real zero-human environment provisioning/implementation evidence rather than synthetic timing simulation.

Frozen customer-proof resources were not changed. No new Railway service/project/environment/domain/database/volume was created, no paid resource was added, and no readiness/security control was weakened.