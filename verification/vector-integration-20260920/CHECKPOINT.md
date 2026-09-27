# VECTOR execution checkpoint — 20 September 2026

Status: **BUILT**. The combined repair passes local exact-runtime checks. The approved real environment has not yet passed a repaired browser action journey.

21 September provenance closure: independent attack testing found that the original verifier accepted an unlisted nested `package.json` that changed Node module semantics without changing the listed-file digest. The verifier now requires the actual regular-file set to equal the manifest, rejects duplicate/non-normalized paths and refuses symlinks or special entries. On exact Node v22.23.2, 50 focused tests and 22 synthetic engine checks passed; an independent verifier rejected the original attack and passed 14 held-out attacks, with zero skips. Evidence: `provenance-closure-20260921.json`. This repairs static local file-set/contents closure only; it does not establish Docker/deployed identity, immutable execution, Railway durability, restore, or browser proof.

Execution window: 20 September 2026 23:30 UTC to 21 September 2026 23:30 UTC. This is the user's target, not a completion guarantee or a claim of uninterrupted background execution.

## Ownership and source

Repository: `paulallen123/-manufacturing-wfm` (private).

- Common candidate: `6667f4217e0c0a8a90cab8d4c7d79f8efd628662`.
- Workflow/access repair: `1aad642a4ec4bbbcb40e933ab2bcae750be50e85`.
- Dashboard/proof truth repair, PR219: `57d5dbe3cc2d3792a330af7541b8f713eb28397b`.
- Integrated candidate: branch `repair/vector-integrated-engine-proof-20260920`. Its Git history preserves both parents. The immutable commit is the one containing this checkpoint; use its SHA when binding a release.
- Foreground owner: current execution session, integrating and verifying the two existing repairs. Source integration and deployment diagnosis were delegated independently; editing ownership has returned to this session.
- Preserve all unrelated source from the full first-parent tree. The 58-file local manifest is a materialized subset, not permission to replace the repository.

The retired review interface formerly supplied handlers still called by Time Review/payroll. Existing repair code reconnects those handlers to authenticated business APIs. PR219 corrects dashboard values and prevents a proof wrapper reporting success when its runner fails. This candidate combines them and fixes stale test provenance. It retains the new Vector interface and sealed real engine.

## Repeatable evidence

Run from a full checkout, using Node **v22.23.2**:

```sh
node scripts/run-local-vector-proof.mjs /tmp/vector-evidence-run-001
```

Choose an unused output directory. This command assembles the sealed engine with current overlays, hashes all 150 runtime files, runs focused tests, creates isolated synthetic SQLite stores, exercises authenticated APIs and saves logs/results. It does not access a deployment, send payroll to a provider, or change real accounts. Runtime composition is not the full Docker admission build.

Current evidence: `verification/vector-integration-20260920/repeatability-run/`.

- **41/41 focused tests passed**, zero failures or skips: security/recovery, workflow controllers, dashboard/proof regressions and tamper rejection for evidence provenance.
- **13/13 employee/manager API checks passed**: populated leave request, entitlement reservation, duplicate/stale/concurrent edits, self-approval refusal, tenant isolation, actual manager approval (HTTP 200), fresh login, controlled restart, persisted audit and payroll holds.
- **9/9 payroll API checks passed**: seven fictional attendance exceptions resolved, four teams signed, reconciliation, checksum-bound 172-row CSV, idempotent release, tenant refusal, manual handoff marker, forbidden void after handoff, saved batch/CSV after restart. No provider submission occurred.
- The 22 engine checks passed once independently and again via the single reproduction command against newly composed runtime and fresh databases.
- `candidate-source-manifest.json` identifies the final local source inputs. `initial-source-integration.json` records the earlier, unmodified two-parent assembly and its 39-test run; it must not be mistaken for final provenance.
- Runtime digest: `b52730837a6cef2da0f63d95ca2e4cfde882aa37f0de1eb6ba532036bd9c9369`.
- Composed UI JS SHA256: `5ef5a7516003c8cbcfdb00279d128097b0654c06a14ca7d36c36be71af48c040`.
- Composed UI CSS SHA256: `bfe09dfc63a219fa997d7a9671c117e763d05d9f196fceb4ee3ff5ed1cfa976d`.
- Workflow JS SHA256: `3c176dcb56f283b7ed8422c08937bdbcf09dc96ec36c4a3d5ecb67c80188a38a`.

These asset hashes describe local composition. Compare them with actual container/served bytes before configuring strict hosted proof. Do not assume Docker composition yields identical bytes without checking.

## Deployed state and release dependency

Canonical product: `https://wfm-one-day-enterprise-v1-production.up.railway.app`.

- Railway project: `9cd73309-0ece-4b9a-891f-7daa13d94f0d`.
- Environment: `9e7875b6-e214-4c32-9cee-81235e3d49ff`.
- Product service: `8cadddc3-15e9-4c38-a93f-0af829054f29`.
- Observed SUCCESS deployment: `a2b4a0ca-83d3-4285-b16f-f8d0f9dbb97c`; release source `338e07b24d3096d30dcc97fe14c33a03261b7e86`. Served frontend/backend byte binding is not yet established.
- The live page loads its sign-in form. No authenticated product/browser session is available to this execution session.
- Railway reports no volume or bucket, while deployed code uses local SQLite through `WFM_DB`. Current database path, coherent external backup and restore remain unverified.
- **BLOCKED: safe live promotion.** Obtain an authorised owner/runtime session; take a coherent online SQLite backup from the currently running product, preserve it outside the ephemeral container, verify an independent restore and current schema/identity/state, then establish persistent storage before replacing/restarting the product. Copying a live database file alone is insufficient when WAL is active.
- Available Railway tools have no shell/container-file-download/full-database-snapshot operation. Scoped app exports are not full backups. Redacted variable values and an exhausted agent route were not repeatedly retried.
- Do not remove security holds, reset the database, switch to a retired service, deploy an unauthenticated shell or synthesize a privileged session to work around this dependency.
- Owner access recovery is implemented but disabled by default, and has not been provisioned or deployed. Use legitimate owner recovery; its presence is not proof that product access has been restored.

The new repair branch and draft PR have no observed automatic canonical-deployment path. Two existing PR gates should run: `sanitize-sealed-runtime.yml` and `vector-only-ui-guard.yml`. Merging into the candidate branch matches deployment workflows, so keep the PR unmerged until preservation and release evidence are established. Full Docker admission has not been run in this workspace.

Browser recorder remains a separate service: `bf962aba-0c56-4620-b81e-44d43c9a1456`. Its latest failed deployment exposed scheduling-only logs; root cause is unknown. Earlier runner success reported zero exercised action journeys and unbound assets. Do not relabel those reports or unrelated local videos as deployed proof.

## Shared task register and six existing workstreams

The execution brief was appended successfully to all six existing enabled workstreams; original scope, requirements and schedules were preserved. No duplicate automation was created. This does not change their configured model. Enabled flags and recent run records exist; the tool did not supply a next-run timestamp, so uninterrupted execution is not claimed.

| Workstream / existing task | Current owner scope | Next executable result | Acceptance evidence |
|---|---|---|---|
| Orchestrator — `6aabbaef5f6c8191a2ef2e3d6436fdd8` | Shared register, release ownership, dependency order, deduplication | Reuse this candidate/checkpoint; assign one editor per shared area; release only after preservation | Commit, deployment, ownership and concise evidence links agree |
| Product — `6aa93ea528c88191b82973ecb557189b` | New Vector interface and customer journeys | Exercise employee leave → balance/overlaps → manager decision in the browser, then attendance, schedule, weekly approval and payroll | Populated UI before/after, authenticated API result, audit, refresh/login/restart; source/served binding |
| Trust, Proof & Release — `6aab0609c2d08191a17cecf6de5e323f` | Security, database durability, admission, independent proof | Preserve current DB, verify restore and Docker admission; repair separate recorder; capture scoped repeatable proof | Role/tenant/concurrency controls, durable deployment/restart, video/trace/screenshots/errors and state assertions |
| Implementation & Support — `6aad52d7d5808191b562e965b50ea925` | One-day provisioning/import/training; autonomous support | Continue existing engine; turn each remaining manual dependency into a bounded elimination task | Sign-up to trained go-live, reconciled import, injected fault → detection → isolated repair → verified recovery |
| Integration & Data Fabric — `6aadb48162b88191b702074fb100ee79` | Existing connector/data contracts; Factory Graph foundations | Reuse adapters; choose the next actual provider test with available authority and data | Discovery, mappings, identity, provenance, dedup/replay, renewal/recovery, reconciled provider evidence |
| Frontier — `6aac6504804081918fba07d4e07d6612` | Cross-domain experiments and future ideas | Retain independent bounded experiments without taking shared release/UI ownership | Measured result against a strong simple baseline, permissions/safety preserved |

## Full ambition retained

The following is a requirements index, not a claim that all listed capabilities are implemented. Keep existing finer-grained records and completion evidence; do not overwrite them with this coarse index. The full accepted brief is copied unchanged into `EXECUTION_BRIEF.md`.

| Area / customer benefit | Retained requirements and ideas | Dependency | Required proof |
|---|---|---|---|
| Product / reliable daily work | Self-service, leave/balances/overlaps, attendance corrections, shifts/swaps/breaks/absence/overtime/premiums, skills expiry, fatigue/rest, production staffing, weekly approval, payroll, mobile/desktop | Bound UI/API/identity/SQLite path; policy and financial contracts | Completed role-specific journeys and independently expected calculations |
| Implementation / one-day go-live | Signup, isolated cloud provisioning, discovery, bulk import/configuration/reconciliation, customer training; zero-human implementation | Identity/provisioning, connectors, lawful authority, durable configuration | Complete Golden Customer Journey; every remaining manual step measured |
| Integration / fewer manual transfers | NetSuite, SAP, ERP/HCM/payroll, MES, maintenance, access control, files, MuleSoft; reusable discovery/mappings/identity/provenance/replay/dedup/token renewal/recovery | Provider authority, test data and shared semantic contracts | Separate simulated, hosted synthetic, actual-provider and real-customer outcomes |
| Manufacturing intelligence / grounded decisions | Employee/line twins, permissioned Factory Graph and source history, orders/assets/maintenance/materials/skills/cost, document/CAD/BOM/revisions, semantic search and grounded actions | Proven source identity and tenant-scoped graph/data access | Source-linked answers, permitted actions, revision correctness and measured retrieval quality |
| Workforce economics / reconciled value | Agency demand/suppliers/rates/compliance/assignment/invoices, energy-aware staffing/production, cost-to-serve/good unit/capacity/maintenance, operational/finance dashboards | Accurate pay/time/production/energy/supplier data | Independent reconciliation; forecasts, avoided costs, released capacity and booked savings separated; no double-counting |
| Clocking / zero new hardware | Invisible/self-clocking from lawful existing signals, privacy and correction, offline/duplicate/missing/ambiguous events | Signal coverage and authority, identities, deterministic event controls | Coverage/latency/error/recovery measurements; inferred presence distinct from confirmed work |
| Support and security / zero human support | Prevention/detection/diagnosis, isolated repair verification/promotion/rollback, compound faults, permissions/supply chain/audit/backups/recovery | Durable state and constrained tool authority | Injected failures, measured detection/repair, recurrence, recovery integrity and manual dependency count |
| Frontier and learning / better manufacturing outcomes | Cleanroom/intervention orchestration; people/production/maintenance/agency/energy/quality/cost; adaptive learning; authoritative qualification/occupancy/break/safety rules | Current candidate contracts and representative fixtures | Strong baseline comparison; recheck previously reported duplicate IDs/transition contradictions only on relevant source |
| Global scale / same product across customers | One employee/one site through 10,000+ employees and 50+ global sites; geography/time zones/localisation/manufacturing variation | Tenancy, capacity, data/financial semantics | Representative scale, concurrent edits, geography/time boundaries, restore and customer isolation |
| Commercial proof / credible differentiation | Reuse CADDi/WFM/operations/maintenance competitor and RFP research; polished three-minute demo and major-function videos | Working product, lawful evidence, targeted primary-source refresh only when needed | Measured comparisons; actual new Vector recording; no unsupported superiority claims |

## Next safe actions

1. Review draft integration and attached exact-runtime results; inspect the two existing PR gates. Do not rebuild either completed sibling repair.
2. Complete secure owner sign-in to reach the existing Railway/runtime preservation route. Current dependency is account/runtime access, not permission for routine implementation.
3. Preserve and restore-verify the running database; establish durable storage; then promote the reviewed exact candidate through required gates.
4. Bind the served UI and backend to the deployed candidate. Use populated authorised synthetic accounts and record the complete employee-manager journey, followed by attendance, schedule/weekly review/payroll.
5. Continue independent implementation, integration and Frontier tasks under their existing owners. Record exact scoped statuses: PROVEN, BUILT, DESIGNED, RESEARCHED or BLOCKED. Use PROVEN only for the approved real environment.

Usage: two bounded independent delegates; reused existing repairs, workstreams and infrastructure. No new paid service or duplicated automation. Token/cost totals are not exposed; savings are not estimated. No live deployment, restart, credential change or external payroll/provider submission has occurred during this integration.


## 2026-09-27 — Runtime source self-binding

- **Objective:** Bind served Vector proof to the exact deployed GitHub commit without trusting runner configuration alone.
- **Observed evidence:** Fixture deployment `ce35d486-5db0-4a0a-80e4-24bc1c048220` served release `0.6.76-hosted-staging-rc1` from commit `f62f1e9f6d993d3f90ff19f8178275803e5b7d3f`. Hosted browser proof passed one attendance correction journey (16 assertions), security passed 27 assertions, and the independent outside-in verifier passed 9 checks. The security result still recorded `releaseBinding: UNPROVEN` because the target did not self-report its commit.
- **Acceptance:** Hosted startup rejects missing/malformed candidate SHA; a read-only no-store endpoint returns the full SHA and fixture boundary; unrelated routes remain unchanged; exact Docker admission runs the focused tests and copies the module into runtime.
- **Implementation:** Draft PR #259, commit `ab12952cc7d880b2179d9ed12491c317511cf874`, adds `security/runtime/runtime-identity.cjs`, focused tests, bootstrap routing and Docker admission.
- **Verification:** Pre-build test failed on the absent contract. Post-build 3/3 focused tests and syntax checks passed on local Node v24.19.0. Exact GitHub readback repeated the 3/3 tests and syntax checks.
- **Status:** BUILT. Not deployed; the hosted fixture remains on `f62f1e9f6d993d3f90ff19f8178275803e5b7d3f`. Node 22 Docker admission and hosted outside-in endpoint verification remain open.
- **Active-work check:** The release head was `f62f1e9f6d993d3f90ff19f8178275803e5b7d3f`; no open runtime-identity change was found. Existing open PRs #249, #250, #251 and #255 own different areas and were not modified.
- **Dependencies / next action:** Independently admit PR #259 on Node 22, then deploy only to the existing fixture candidate with the preserved volume and verify the endpoint SHA before and after browser/security journeys. Do not promote to customer or production use.


## 2026-09-27 — Build-derived runtime identity hardening

- **Objective:** Remove the circular proof path in which the runtime identity endpoint could merely echo the verifier-configured expected SHA.
- **Discovery / theory test:** Adversarial review showed that a valid but incorrect `WFM_CANDIDATE_SHA` was accepted because no independent build identity was required. The new regression failed 2 of 4 focused tests before repair: missing build identity was accepted and the response lacked an independently matched binding state.
- **Accepted design:** Railway documents `RAILWAY_GIT_COMMIT_SHA` as the triggering commit SHA and provides Railway variables to builds and deployments ([Railway Variables Reference](https://docs.railway.com/variables/reference#git-variables)). The final Docker stage now validates and seals that build-time SHA in `/app/.wfm-build-source-sha`. Hosted startup independently validates the configured expected SHA and sealed build SHA, requires both, and fails closed on missing, malformed or mismatched values.
- **Implementation:** Commit `cd35b72274ff1efe42b70ae4b8aa4ed7e2b5926d` on draft PR #259. The endpoint reports `sourceBinding: build-file-matched` only after the independent values agree; it remains read-only, no-store and fixture-scoped.
- **Verification:** After repair, 5/5 focused tests and syntax checks passed on local Node v24.19.0. Tests cover missing/malformed build identity, mismatched expected/build SHAs, real read-only file input, endpoint payload and method/route boundaries. The exact local Git blob hashes matched the three published GitHub blobs. A valid SHA produced a mode-0444 identity file; an invalid SHA was rejected. No workflow or commit status was published.
- **Status:** BUILT. This is source-level evidence only: Node 22 Docker admission, Railway build execution, hosted endpoint verification and repeated browser/security journeys remain open. No deployment, restart, customer/payroll mutation, DNS change or spend occurred.
- **Dependencies / next action:** An independent Trust/Proof owner should build the final PR head on exact Node 22, configure `WFM_CANDIDATE_SHA` to that same final head, preserve the existing fixture volume, then verify the self-reported SHA before and after the state-changing Vector journeys. A mismatch must be treated as a blocked deployment, not repaired by weakening the check.
