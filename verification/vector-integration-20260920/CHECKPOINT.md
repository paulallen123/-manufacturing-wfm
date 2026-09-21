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

---

## Current Chat recovery and execution — 21 September 2026

This dated entry supersedes earlier ownership instructions only. **Current Chat owns coordination AND execution of every recovered workstream, including difficult technical work. Do not delegate to Astra, Astra Extra High or Astra-led Work without Paul's explicit reauthorisation.** All earlier requirements, implementation, designs, safeguards, schedules and evidence remain retained. The root OneDrive `workforce management project.docx`, freshly fetched by exact item in this session, plus subsequent user instructions remain the requirements authority. This is an append to the existing work register, not a new register/application/interface.

### What actually transferred and what did not

The six enabled hourly automation prompts listed above were read directly. All six already contain the Current Chat ownership override. Their original enabled state, recurrence, scope and safeguards were preserved; no replacement or duplicate schedule was created. This session verifies existing prompt-level routing, not a new model-setting change. In-flight ChatGPT/Astra sessions, hidden queues, scheduler model selection and their termination controls are not exposed. No claim is made to have inspected all conversations or stopped an unseen process.

Before source writes, GitHub's filtered Actions queries returned zero queued and zero in-progress runs. Inspected Railway service snapshots had no build/deploy in progress; these observations are not a global lock. Existing PR comments and file contents were read, bounded edit ownership was announced in PR220 comment 5756926353, and the source write used the freshly re-read blob SHA. Only the existing PR220 branch was changed. Future writers must still re-read current blobs and reconcile concurrent changes rather than overwrite them.

### Recovered jobs, retained evidence and next action

All rows below are owned by **Current Chat**. Where previous results are recorded but not rerun, they remain historical evidence rather than fresh proof. Absence of a fresh execution result is not evidence that a job was never started.

| Recovered job | Existing work/evidence preserved | Verified position and next action |
|---|---|---|
| Approved blue-and-white UI consolidation | PR220; PR221 approved five-section UI; PR222 useful release/verifier work; existing merge history at ab93677008026540208d82c8f449b03f190c9faa | BUILT. PR221 and PR222 are closed consolidation donors, not new independent releases. PR220 remains draft/unmerged. Continue Today/People/Plan/Factory/Improve; never revive green/retired UI. |
| Employee leave, entitlement, overlaps and manager decisions | ux-overlay/vector-workflows.js, Astra repair 2eb8708, verification/astra-ui-proof-fixed-20260921 and existing API/browser scripts | BUILT. Actual hosted log saves one pending request and reserves balance, then fails the overlap-message assertion. Recover exact deployed harness source, synchronise to the actual refusal/result and finish manager decision plus fresh-login readback without replaying an ambiguous write. |
| Shared UI refresh/state coherency | Existing reload() and same-owner 409 refresh paths in vector-workflows.js | BUILT. Source inspected; retain changes. Prove submitted result, refreshed shell and new login agree on the same request/version in the approved environment. |
| Attendance corrections and independent approval | scripts/harden-attendance-integrity.mjs; repair 5362ed5; verification/vector-attendance-proof-final5-20260921; source guards and preserved raw-punch checks | BUILT. Existing code/evidence locations recovered; full engine tests not rerun this session. Continue the served correction, weekly-review and payroll journey with preserved original punches and cross-period/source checks. |
| Payroll reconciliation and locked exports | Existing payroll-journey proof scripts/results and attendance acceptance scripts | BUILT. Historical local 172-row checksum-bound export is retained, not recertified. Prove the same exact deployed release, independent expected totals, immutable export and restart/new-login state. No provider submission is claimed. |
| Post-release adjustment integrity investigation | Existing PR220 comment 5754152956 reports duplicate adjustment deltas and export after source-batch voiding | Open investigation retained; not reproduced or declared fixed here. Reproduce safely on synthetic state, then revalidate cumulative adjustments and source-batch state at proposal, approval and export. Do not lose this behind the main payroll proof. |
| Independent provenance and proof truth | Existing static file-set closure, role/tenant/source guards, scripts/vector-proof-result.mjs and separate Railway recorder | BUILT. New scoped-verification classification gap reproduced and repaired in this session; details below. Existing admission/security gates retained. |
| Canonical data backup, restore and durable storage | Existing product service 8cadddc3-15e9-4c38-a93f-0af829054f29, deployment a2b4a0ca-83d3-4285-b16f-f8d0f9dbb97c; original SQLite preserved | BLOCKED for safe live replacement. Railway still reports no mounted volume; complete coherent backup/restore is not established. Available connector actions expose no shell/full-database download. Obtain an authorised preservation route and verify restore before restart, migration or promotion. |
| Owner access and authentication | security/runtime/OWNER_ACCESS_RECOVERY.md, owner-access-recovery.cjs/tests; prior declined owner-browser authentication checkpoint | BUILT recovery code, not activated or proven. Do not repeat the declined owner sign-in, reveal credentials, invent a session or weaken access checks. Legitimate owner access remains a release dependency. |
| Hosted admission and CI | Existing vector-only/sealed-runtime workflows; hosted fallback service 845b5dcc-9c95-42cf-95fb-5719e96511f2 | Retain prior build receipts and failed GitHub runs without relabelling them. Execute complete declared-runtime admission on the new exact candidate before any promotion. No unchanged failed-run retry was submitted here. |
| Onboarding UI, readiness and bulk intake | Existing Implementation & Support task; master requirements; Railway wfm-vector-onboarding-proof service | Existing implementation records and service retained; no new full onboarding proof. Finish authenticated saved configuration, validated/reconciled import, role readiness and refreshed UI before claiming self-implementation. |
| Automatic isolated cloud provisioning | Existing one-day implementation workstream and source/deployment records | Target retained, not newly proven. Complete sign-up to isolated safe environment, verified durable configuration and handover without a manual provisioning dependency. No new environment was created here. |
| Training and zero-human implementation | Existing Implementation & Support scope, scoping questionnaire, mass configuration and training requirements | Keep the one-day and zero-human targets. Execute one complete customer intake/import/configuration/training/readiness journey and record each remaining manual dependency. |
| Integrations and provider authority | Existing Integration & Data Fabric task, integration proof service 2631d462-61bf-4c01-ac4b-e106a562feeb and existing adapter/contracts | Preserve NetSuite, SAP, ERP/HCM/payroll, MES, maintenance, access control, files and MuleSoft scope. Next result must be an authorised provider exchange with mapping, dedup/replay, renewal/recovery and independent reconciliation; simulation is not provider proof. |
| Manufacturing graph and digital twins | Existing Factory Graph, employee/line twin, CAD/BOM/revision and semantic-search requirements in this register/master | Continue tenant-scoped source identity, revisions, provenance and grounded actions. No new graph completeness claim is made. |
| Scale, localisation and performance | Existing 1 employee/1 site to 10,000+ employees/50+ sites requirements, timezone/localisation and concurrent-edit contracts | Preserve scope. Re-run representative exact-runtime load, time boundaries, isolation and recovery; previous throughput claims are not fresh production proof. |
| Autonomous support and safe repair | Existing enabled Implementation & Support/Trust tasks; zero-engineer support and recovery work | Preserve monitoring, fault injection, isolated repairs, verified promotion/rollback and all support tiers. Demonstrate a real detected fault through verified recovery; no all-tier zero-human claim here. |
| Mobile, tablet mass clocking and invisible attendance | Latest blue-and-white concept requirement; mobile/tablet and lawful existing-signal scope in master and Product task | Keep employee/manager/operations/director views, offline capture, identity, duplicate handling, privacy and corrections. No new UI, hardware purchase or silent attendance-as-work assumption. |
| Agency, energy, manufacturing economics and frontier learning | Existing Frontier task and full ambition table above | Preserve agency suppliers/rates/compliance/invoices, energy-aware production/staffing, quality/maintenance/materials, cost-to-serve and measured learning experiments. Reconcile outcomes against a simple baseline; do not invent savings or double-count them. |
| RFP, competitive evidence and commercial value | Existing research, evidence-strength distinctions and value requirements | RESEARCHED where only research exists. Retain the evidence and gap backlog; no unsupported customer outcome, superiority claim or company-valuation increase from reassignment. |
| Golden Customer Journey and narrated video | Existing Trust/Proof scope and recording artifacts/checkpoints | BLOCKED for final approved-environment proof until the journey and release/data gates pass. Preserve prior recordings as historical/local evidence only. The requested narrated three-minute real-product video remains outstanding. |

### Actual engineering advanced in this session

A real defect was reproduced in `scripts/vector-proof-result.mjs`: setting all leave/attendance action flags true could mark both scoped journeys verified even when deployed asset identity was missing or UNBOUND. The result still held whole-product readiness false, but the scoped verification was too strong and could validate evidence from the wrong interface.

The minimal correction requires BOUND deployed assets as well as every original strict-boolean action check. No UI/business/authentication code, customer data, security hold or deployment configuration changed. Existing implementation and donor histories remain intact.

- Repair commit: `bbbc7b6ce6a333a143198b56cf7e573b0dbf51df`.
- Regression commit: `f4c6153998393b9f48d55a614f153b14481a0b64`.
- Original source blob: `f2df0bf8d3f2fb05685bf685420400da69049662`.
- Repaired source blob: `36cae9390a9c6c50cea315343861964100588924`.
- Test file: `scripts/vector-proof-result-identity.test.mjs`; blob `e841483229dfc2659fef64adedcf7a33f458f9a9`.
- Command: `node --test scripts/vector-proof-result-identity.test.mjs`.
- RED: 23 tests, 16 pass, 7 fail, zero skipped on the original exact source blob.
- GREEN and fresh repeat: 23/23 pass, zero failed/skipped on the repaired source.
- Runtime actually used: Node v22.16.0, NOT the declared hosted admission version v22.23.2.
- Full project/engine suite and Docker admission: NOT RUN in this session; complete application checkout/runtime was unavailable. This is BUILT proof-classification repair, not deployed PROVEN functionality. The new regression has an explicit reproduction command; automatic inclusion in every existing targeted CI runner has not been established.

The current hosted browser log was inspected directly, not inferred from a previous update. Deployment `ef24bd11-529c-4fcb-b164-d0c66ce0f228`, run `ec1d7068-f2bf-4164-a988-626c6bd9573d`, checked at 2026-09-21T02:42:48.868Z, targets fixture candidate `ab93677008026540208d82c8f449b03f190c9faa`. It records exact served JS/CSS/workflow assets, five role logins, section navigation, reload/mobile checks and one saved employee leave request. The run FAILS next with an empty string against `/overlap|already|request/i`; manager-decision completion is not demonstrated by that run.

A local Chromium diagnostic reproduced the same premature visible-region/empty-text assertion pattern found in the repository's browser script. A bounded wait for visible matching text succeeded and separate no-message, unrelated-message and hidden-message controls refused success. This is a small isolated diagnostic, not a substitute Vector UI or real backend proof. Its initial same-page negative-control experiment behaved unexpectedly; independent pages were used afterwards and the underlying initial diagnostic issue remains unconfirmed. No hosted root-cause closure is claimed.

Crucially, the running Railway harness executes separately hash-guarded environment source, not simply that repository script. The exact environment-source contents were not recovered. Patching the similarly named file would not prove the active harness changed. The existing recorder is separate from the product; its FAIL does not mean the product is down. The local HTTP route also failed DNS resolution, so this session used connector reads and local source-bound tests rather than repeating the failing network route or bypassing access controls.

### Current release boundary

The fixture candidate remains on its existing release branch at ab936770; the older canonical product and its SQLite were not restarted or replaced. There is still no full approved-environment leave/attendance/payroll Golden Journey, safe restart/durable-storage proof, new narrated marketing video or actual-provider result from this session. No hidden model/job transfer, full conversation audit or independent reviewer approval is claimed. Reassignment is not product progress; the delivered result here is the bounded tested code repair plus recovered, preserved and explicitly owned work in this existing register.
