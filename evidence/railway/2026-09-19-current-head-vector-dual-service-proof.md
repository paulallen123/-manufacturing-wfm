# Exact-current-head Railway dual-service proof — 2026-09-19

## Candidate identity

- Repository: `paulallen123/-manufacturing-wfm`
- Feature branch: `feature/one-day-enterprise-implementation-v1`
- Exact tested SHA: `9c12c55733bf9e8b55b34cf39ffa32632cac1331`
- Candidate commit: `Replace rejected shell with approved Vector UI`
- Approved presentation marker assembled in the Railway image: `VECTOR_WORKFORCE_OPERATIONS_APPROVED_V1`
- The GitHub feature branch was re-read after both deployments and still resolved to the exact tested SHA.

## Railway deployment provenance

- `wfm-one-day-enterprise-v1`
  - Deployment: `bfc944ba-2c06-4682-a9dc-c66730508b96`
  - Status: `SUCCESS`
  - Commit: `9c12c55733bf9e8b55b34cf39ffa32632cac1331`
- `wfm-integration-fabric-v1-proof`
  - Deployment: `df1388c1-06ed-4dd1-95e7-ee0c8e4fe353`
  - Status: `SUCCESS`
  - Commit: `9c12c55733bf9e8b55b34cf39ffa32632cac1331`
- No new Railway service, database, volume, environment or paid infrastructure was created for this proof.
- The proof runner reports `productionMutation=false` and `customerMutation=false`.

## Admission and regression gates

The exact-current-head integration Railway build completed the full candidate test stage with:

- 66 tests
- 66 passed
- 0 failed
- 0 skipped
- 0 cancelled

The image retains the strict T0–T4 autonomy admission gate and the candidate's fail-closed controls. Covered gates include:

- mass workforce assignment and deterministic configuration inference;
- readiness blocked until required evidence and role competence exist;
- append-only implementation and learning evidence;
- tenant isolation across implementation, discovery, learning and lifecycle flows;
- managed credential references with raw credential rejection;
- OAuth PKCE, signed state, expiry/tamper rejection and server-side secret handling;
- URL/redirect/pagination protections, including malicious cross-origin `nextLink` rejection;
- trusted-worker-only provider authorization attestation;
- safe schema-drift degradation and reconciliation metadata minimisation;
- role-specific curriculum, independent mastery, teach-back and targeted refresher/delta learning;
- overnight clocking, duplicate/post-leaver clock rejection;
- absence bounded by employment;
- approved overtime override with no direct payroll mutation;
- bounded/non-overlapping agency assignments;
- effective-dated starter, transfer and leaver handling;
- retro changes preserving original evidence;
- integration outage protection and checkpoint-required recovery;
- idempotent, append-only and tenant-isolated lifecycle ingestion.

## Real Railway cloud scale and payroll proof

The exact candidate cloud-scale proof returned `PASS` with all assertions true and no failed assertions:

- Employees: 10,000
- Sites: 50
- Punches: 100,000
- Timecards: 40,000
- Cohorts: 1,750

Independent deterministic payroll reconciliation:

- Expected total: 15,180,000
- Calculated/projected total: 15,180,000
- Unexplained variance: 0
- Variance count: 0

Deliberate corruption challenge:

- Expected total: 15,180,000
- Corrupted projected total: 15,180,020
- Detected unexplained variance: 20
- Variance count: 1

Hostile-data challenges also detected duplicate employee IDs, orphan managers, missing workforce structure and a malformed punch, and correctly blocked unsafe auto-application.

## UX evidence boundary

The exact-head image syntax-checks and assembles the approved Vector Workforce Operations shell after the existing Version D implementation journey and preserved role-first/adaptive learning layers. This is build/deployment evidence that the approved shell is present in the candidate image. It is **not** independent proof of complete authenticated role-by-role browser journeys.

## Claim boundaries and open hard gates

- Provider tests prove adapter, authorization, discovery and security semantics in the candidate test harness. They do **not** establish a live authenticated NetSuite, SAP, HCM, payroll, Entra, Okta or Google Workspace provider connection.
- Existing hosted evidence remains fixture/test-harness only where no authorized provider credentials are present. No provider is claimed live without authenticated provider evidence.
- The eight-hour implementation timing result is explicitly `SYNTHETIC_THEORY_ONLY`; it is architecture timing evidence, not a real zero-human customer implementation or real environment-provisioning proof.
- Complete authenticated role-by-role hosted browser journeys remain open.
- Sell-readiness therefore remains `CONDITIONAL` until those hard gates are closed.

## Change safety

This evidence record was created on isolated branch `evidence/24h-sell-readiness-20260919-0059` from the exact tested SHA. The feature candidate was not changed by this evidence commit. No action in this proof run targeted or modified the frozen customer-proof release, and no readiness/security control was weakened merely to obtain a pass.
