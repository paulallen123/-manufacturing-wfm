# F7 operational-period ingestion evidence validator

Owner: **Continue customer proof**, sole canonical integration/live owner.
Requirement: [issue265 comment6114347631, F7](https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6114347631).
Prepared 2026-10-11. This is an additive validation-only review package, not an
integration, readiness admission, rollout or hosted customer journey.

## Deliverables and exact source binding

Only these new repository files are proposed:

- `scripts/operational-period-ingestion-proof-oracle.mjs`
- `scripts/operational-period-ingestion-proof-oracle.test.mjs`
- This handoff.

Intended base: `8632e5bb5c84e4fc258311d31d973714be169866`, repository
`paulallen123/-manufacturing-wfm`. The validator pins that inspected source SHA;
a changed source needs renewed inspection/versioned adoption, not inherited proof.
The available local checkout was `5ea6d4664e52348557e7e6284fe75a1c98d8a976`,
and did not contain the requested base object. No Git network operation was used.
Authorized GitHub connector reads verified the requested commit, the sources
below and absence of all three proposed paths at that base. The additive patch
does not claim a full exact-base checkout or a full combined-build verification.
The owner must apply/check it on the exact base before integration.

No local AGENTS.md or .agents skills were found. Exact-base reads of AGENTS.md,
scripts/AGENTS.md and .agents/skills returned 404. The delegated-task exemption
in the available using-superpowers skill applied. The Library skill was used for
the requested review bundle. No repo instructions were fabricated.

Inspected evidence (connector reads, 2026-10-11):

| Source | Binding / relevant contract |
| --- | --- |
| [F7 requirement](https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6114347631) | Accepted requirement, expressly rejects unsafe PR297 implementation; sole owner and real post-deployment proof remain required. |
| [Current period reconciliation](https://github.com/paulallen123/-manufacturing-wfm/issues/265#issuecomment-6113562940) | Period side table is unused; current calendar selects existing canonical state and does not ingest a missing period. |
| [PR297 and its review](https://github.com/paulallen123/-manufacturing-wfm/pull/297) | Inspected patch and review: forbidden client tenant header, unused `vector_operational_periods`, impossible-date acceptance, provenance conflict silently ignored. Copied none of its runtime/writer code. |
| [Exact-base Dockerfile](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/Dockerfile) | Requires sealed artifact SHA256 `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`; local artifact bytes matched. |
| Sealed `public/payroll-control.js:197–208` | SHA256 `ec5fa3cd5cb2bc4d2e66694b6211ad3dc8c24ea279bd48b0bc0fa01260eb1200`; `openPeriodFromSource(s,a,input)`, `time.ingest`, Monday start, period id=start, end=start+6, London next-Monday-noon deadline, frozen roster, staff/org teams, copied attendance records, draft reviews, activation, one `weekly-source-ingested` audit entry. |
| Sealed `public/payroll-control.js:24,30,61–78,178–182` | Canonical `payrollControl.periods`; audit shape; duplicate ID/day and seven-daily-outcome blockers; weekly and payroll response shapes. No payroll calculation was copied. |
| Sealed `public/time-review.js:10,12,49–55` | SHA256 `4779479574ddfe005255c6fba30e51e366f270a14c1dc66a63de7767c3dfac4c`; active keys `period|team`, canonical-string fingerprint (NOT SHA256), default name/date ordering, unfiltered page total/all, offset, limit 1..100, hasMore. |
| Sealed `server.cjs:104,367,418–419` | SHA256 `1792f544d0fea25577f683f3df957b4f74b6a086cd0479b24b1fe77f58587dd0`; generic transaction wrapper and actual Time Review/weekly/payroll GET consumers. Generic mutation increments version and calls syncToday; **no verified period ingress links it to openPeriodFromSource**. |
| [tenant-calendar.cjs](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/operations/runtime/tenant-calendar.cjs) | Git blob `7a0ef87512fc4113171f4c988df8377706a33332`; canonical current period projection and historical sort/12 limit; server site zone/date; maxAgeMs and 30,000ms future tolerance. |
| [tenant-calendar.test.cjs](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/operations/runtime/tenant-calendar.test.cjs) | Git blob `00eee43573987ad4bd4ab12b27e8dce0c35e689b`; no historical fallback, overlap failure and freshness tests inspected, not executed here. |
| [compose-vector-local-runtime.mjs:85–98](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/scripts/compose-vector-local-runtime.mjs) | Git blob `c7681113c05f534e69ff3918dfe656983fd2f153`; authenticated actor tenant/site context and `/api/current-review-period`. |
| [harden-attendance-integrity.mjs](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/scripts/harden-attendance-integrity.mjs) | Git blob `893e9881d69316edbe801a9d01c51db0d28fe81a`; inspected correction hardening does not replace period ingestion. |
| [patch-payroll-money.mjs](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/scripts/patch-payroll-money.mjs) | Git blob `2b4310c14413abffa8f4809a5864492ee0647462`; cost/work-rules changes, not a new period contract. |
| [patch-customer-runtime-assets.mjs](https://github.com/paulallen123/-manufacturing-wfm/blob/8632e5bb5c84e4fc258311d31d973714be169866/scripts/patch-customer-runtime-assets.mjs) | Git blob `ea4cac7d3404747b900809b479f80c29d1158e0b`; inspected UI transforms do not establish an ingestion route. |

Snapshot-profile review additionally inspected these files extracted from the same
hash-verified sealed artifact (SHA256, not Git blob IDs):

| Sealed source | SHA256 | Profile contribution |
| --- | --- | --- |
| `public/core.js:6–17` | `7884119d1b1cd3f28d3bdf130b1733a0ba9d187bf92dea8bd8bc7980aebd8218` | seed org/staff/requests/audit/shifts |
| `public/engine.js:56,110–117` | `bd54d977582f2dbb9d4571d5184b553e5ade350ab077805f337a392324eae944` | resolveLondon canonical UTC output; version, jurisdiction, rulesVerifiedAt, availability/offers/assignments/gaps/profiles/history |
| `public/cost-engine.js:252–257` | `9dce4e7281da433d1b8ae2efa783bd0e30fef43d4c4f6e0e210478ff0c3475f5` | costing schema 3 and containers |
| `public/work-rules.js:240–241` | `bfd456214b9581f97bd9fd6be25f4f6b3266974483c3dffcded520b1390bed4a` | workRules revision and containers |
| `public/readiness-engine.js:15` | `3938b68823864d2c8f91136df47ed8b983bd6c1e5e27a301deb5cf1d9e59ff90` | readiness schemaVersion 1 and collections |
| `public/schedule-publication.js:13` | `6678113945a1196174564a277d8e61ba64af61684c7e27c8d53c06dcbebe50f9` | schedulePublication schemaVersion 1, collections and O.decorate dependency |
| `public/org-admin.js:8–13` | `1910c2919ea47d08b9f4aa8c52818e9117127c9dc959c72d723959ede97b79cf` | orgAdmin schema/revision/baseOrg/changes/receipts |
| `public/onboarding-engine.js:10` | `c06b354826747387fe14763dba5cef681ae08a1cf64d83d2fb54c1b13338476e` | onboarding schemaVersion 1 and collections |
| `public/attendance-corrections.js:12` | `d76c6b64aa7ef17eaf13333cfdbef773453b814d54eb354fcdc84b5885bcb461` | requests/notifications/receipts containers only; no correction-engine logic copied |
| `public/operations-engine.js:21` | `73678a22593433928b52dd7bee75ee2f9f75cca3d777711209aa0fa7706b1302` | operations schema/revision and containers; D.decorate dependency |
| `public/demand-engine.js:27–56` | `c8adb3f2b023a106250b06877b0e46ed499a7152ce148d14f915e278e2645218` | demandPlanning schema 6, revision and containers |

## Proposed adapter contract (not an existing receipt schema)

`validateOperationalPeriodIngestionProof(packet)` is synchronous and pure. Its
only import is Node's crypto hash primitive. No filesystem, network, database,
provider, clock, runtime module, period writer, readiness or controller calls.
Input is bounded plain JSON data. Do not pass proxies or behavior-bearing objects.
The tests contain an executable synthetic example of the entire envelope.

Output:

```json
{"schemaVersion":"operational-period-ingestion-proof/v1","status":"consistent","readiness":"not-proven","provenance":"requires-trusted-caller-verification","issues":[]}
```

Any missing/mismatched evidence returns `status: "not-proven"` and deterministic
`{code,path}` diagnostics, with evidence-gap codes for missing owner/consumer/state/
replay evidence. `consistent` proves only internal consistency of supplied data.
The module cannot authenticate its caller, receipts, identities or write journals.
`PASS`, `signed`, `verified`, owner names, hashes and reference strings cannot do
that. They never substitute for required evidence. Never expose this function as
an untrusted HTTP proof/admission endpoint or use its status alone for readiness.

The owner must independently authenticate/authorize every evidence source and
derive `expected` outside caller-controlled payloads. An attacker controlling both
the expected values and evidence can fabricate a consistent packet. This is an
explicit trusted-caller precondition, not a solved security claim.

Top-level fields:

- `schemaVersion`: exactly `operational-period-ingestion-proof/v1`.
- `expected`: trusted `binding` with tenantId, exact sourceSha, deploymentId and
  configurationDigest; authoritative `now`; `calendar` with configured timeZone,
  site and maxAgeMs; exact `period` (`id,start,end,deadline,source`); ordered
  `roster` projections (`id,manager,name,site`); SHA256 `inputDigest`; and
  `snapshotManifest` with schemaVersion `sealed-load-with-time-review-and-corrections/v1`,
  sourceSha equal to the pinned source, artifactSha256 equal to the sealed artifact,
  and an independently obtained authoritative SHA256 `preStateDigest`. The latter
  must not be copied from the supplied packet's pre snapshot.
- `ownerEvidence`: externally verified owner/actor/permission and tenant-resolution
  references; owner `Continue customer proof`, `actorId`, `permissions` including
  time.ingest, `tenantBinding: authenticated-server-context`, `tenantResolutionRef`,
  distinct collectorId/independentCollectorId, evidenceRef and exact binding.
  These are normalized adapter fields, not newly issued authority receipts.
- `ingestion`: evidenceRef, binding, collectorId, actorId, seam exactly
  `WFMPayroll.openPeriodFromSource`, startedAt/completedAt, actual `input`, its
  digest, actual `{id}` result and independently retained audit entry.
  Actual input fields are start, employeeIds, records, sourceReference and
  completeTeams. This complete-proof profile requires all frozen teams complete
  and every employee/day represented; the runtime's ingestion function permits
  incomplete feeds but its weekly review blocks them.
- `states.pre/post/restart/freshSession`: schemaVersion exactly
  `sealed-load-with-time-review-and-corrections/v1`, evidenceRef, collectorId, binding, at,
  processId, sessionId, complete tenant `state` and SHA256 `stateDigest`.
  Schema v1 checks the domain seam's precise mutation footprint: append one
  canonical period, append one payroll audit entry, add target active team keys.
  Every other field, including preexisting periods and correction/payroll state,
  is unchanged. Existing Time Review state must be present: its initializer is
  not silently guessed by this profile. The complete source-declared container
  profile is required before comparisons, including state.version and typed
  positive safe-integer revisions; Time Review response version/configRevision
  must also be explicitly present and correctly typed.
- `lifecycle.restart/freshSession`: independently collected evidenceRef/binding,
  collectorId, at, from/to process or session identity. Restart must change process;
  new login must use a session distinct from **every prior checkpoint** (pre,
  post and restart), and preserve the restarted process/state. Same-session reads
  within a checkpoint remain required. Session/assertion authenticity remains an
  external collector obligation; this schema does not contain assertion receipts.
- `readbacks.post/restart/freshSession`: each has currentReviewPeriod, timeReview,
  weeklyReview and payroll. Each read has evidenceRef, independent collectorId,
  binding, at, processId, sessionId, observed stateDigest and query. Query is `{}`
  for currentReviewPeriod, otherwise `{period: id}`. Complete unfiltered all-team
  Time Review uses ordered `pages` of actual response bodies; other consumers use
  `body`. All four consumers must see the same canonical period. Their matching
  stateDigest is collector metadata, **not** an invented HTTP response field.
  The reader must have real authorized scope over the frozen roster; do not forge
  aggregate responses from unrelated users/tenants. Narrow-scope aggregation
  requires a reviewed adapter revision and explicit scope coverage evidence.
- `replays`: at least one each of identical, conflicting, invalid. Each has unique
  id, kind, evidenceRef, binding, independent collectorId, actual input/inputDigest,
  before/after complete independent snapshots, startedAt/completedAt, outcome and
  statusCode. Existing-period identical/conflicting attempts are rejected/409 by
  the inspected seam; no successful idempotency receipt is invented. Invalid
  attempts may return 400 or 409 because the existing-period guard precedes row
  checks. Invalid/conflict labels are checked against actual supplied inputs.
  Every attempt must preserve the entire post state and independently show zero
  writes via `effects: {evidenceRef,beforeCursor,afterCursor,writeCount,writes}`:
  equal nonempty cursors, count 0 and empty writes. This is a proposed normalized
  authoritative write-journal observation; no such collector has been verified.
  State equality alone cannot exclude writes later rolled back or compensated.

Hashes use SHA256 over canonical JSON: recursively sorted object keys, original
array order and JSON primitive encoding. They are consistency checks, not signatures.
Time Review fingerprints instead use the **actual runtime canonical string** over
id/employee/team/date/sourceVersion/raw/correction/schedule/plannedMinutes/breaks.
No arbitrary age threshold is added: trusted calendar.maxAgeMs and the inspected
calendar future tolerance are used. Each observation also follows its operation/
restart/login chronologically, preventing old reads with relabeled sessions.

Deadline fidelity: the actual ingestion seam uses
`E.resolveLondon(C.addDays(start,7)+'T12:00')`. Validation requires canonical UTC
`toISOString()` text with zero milliseconds representing exactly the following
Monday at noon in Europe/London, using that timezone's DST rules. Equivalent
offset-form text, a later Monday, arbitrary future dates and wrong seasonal UTC
hours are not exact supported readbacks. This verifies the inspected seam; it
does not introduce a rollover writer or a new business deadline algorithm.

Snapshot completeness: `STATE_PROFILE` is a closed source-bound container schema,
not a generic completeness boolean. It covers core seed + engine decoration,
the sealed initTenant/load chain (C/P/R/RD/SP/OA/ON and SP->O->D), plus existing
Time Review and attendance-correction decoration. Required root containers and
their source-declared fixed fields cannot disappear uniformly across snapshots.
Unknown root/fixed-container extensions and unsupported schema versions produce
explicit evidence-gap/unsupported-snapshot diagnostics. Dynamic map entries and
row content remain opaque to this ingestion-only validator; the trusted initial
state digest binds their entire content and existing full-state comparisons
preserve it. This is not a reimplementation of their domain validation.

The earlier synthetic `company` field was an unrelated-state sentinel, not an
inspected sealed state field. It has been replaced by the source-backed operations
container. A top-level company extension is now unsupported, rather than invented
as a required runtime contract. A real runtime with additional overlays requires
an inspected profile extension and actual collector evidence. Do not prune real
state to fit the profile. The profile identifies known shape; external collector
provenance/completeness and authoritative expected-state acquisition remain
unproven and cannot be certified by a self-consistent packet or digest.

Bounded profile limits: depth 32, 600,000 visited nodes, array length 20,000,
individual string length 65,536, aggregate characters 16,000,000; envelope identity
strings at most 160 characters. These are resource bounds for this validator,
not claims about runtime business limits or 10k-employee scale proof. Oversize
packets fail closed; never silently sample, truncate, or omit required evidence.
The full VECTOR backlog remains F0–F7; this package covers only the delegated F7
proof validator and does not close the other requirements or the separate
attendance-correction oracle.

## Validation and review evidence

Executed locally: Node **v24.19.0**, `node --test --test-reporter=tap
scripts/operational-period-ingestion-proof-oracle.test.mjs`: **159 passed, 0 failed**.
Node 22.23.2, the exact Docker runtime preference, was not installed; no download
or package installation was attempted. Syntax and additive patch whitespace were
checked. Tests use bounded synthetic tenant/employee/manager/process/session IDs;
none are live owner receipts, provider evidence or hosted fixtures.

Coverage includes valid complete evidence; deterministic frozen-input behavior;
all mandatory consumer/phase omissions; source/deployment/config/tenant mismatch;
client tenant and forged PASS substitution; date/Monday/interval failures; roster,
record ID/day/order/count/fingerprint mismatches; imported correction/treatment;
side-table-only, absent, duplicate and overlapping periods; unrelated-state
immutability; exact audit/activation; stale restart/session/readback/clock evidence;
pagination loss/duplication; zero writes and state equality independently required
for all three replay classes; malformed/accessor/cyclic/sparse/oversize inputs.

Independent review regression: a restart switched to a temporary session, then
freshSession reused the original post-ingestion session with all lifecycle/read/
replay metadata updated consistently. Before the fix, both rejection regressions
failed because the validator returned `consistent`; the genuinely new-session
control passed. The fix compares the fresh session with all prior checkpoint
sessions. Three added tests cover the reproduced bypass, every prior checkpoint,
and legitimate same-session reads under a genuinely new fresh session. The bundle
retains `session-reuse-before-fix.tap` as reproduction evidence, separate from the
passing final test report. This is a consistency fix, not receipt authentication.

Independent completeness regressions also reproduced: uniformly removing company/
attendanceCorrections, or removing state.version/timeReview.revision and matching
consumer versions, both returned `consistent` before the fix. Retained evidence:
`snapshot-completeness-before-fix.tap` (two expected test failures). New tests remove
every declared root and fixed container field uniformly, check version/revision
types and manifest bindings, reject unknown extensions, and detect dynamic-field
omission using the trusted pre-state digest.

Independent deadline regression reproduced a uniformly rebound November deadline
being accepted for the October week. Retained evidence:
`deadline-before-fix.tap` (one expected failure). Positive fixtures now use actual
canonical UTC output. Tests cover spring-forward, autumn-back and the following
winter week, wrong seasonal UTC hour, noncanonical text and wrong date/seconds/
milliseconds. `sealed-deadline-contract.txt` records a read-only local execution
of the actual sealed C.addDays/E.resolveLondon functions: weeks 2026-10-05,
2026-03-23, 2026-10-19 and 2026-10-26 produce respectively
2026-10-12T11:00:00.000Z, 2026-03-30T11:00:00.000Z,
2026-10-26T12:00:00.000Z and 2026-11-02T12:00:00.000Z.

Not run: exact-base combined build, Node 22 tests, Docker composition, runtime
ingestion, HTTP ingress, database transactions, restart/fresh-login against a
hosted service, browser/payroll/provider journey, integration, full-scale proof,
independent human/owner review, readiness admission or release. No pushes, merges,
deployments, DB/provider writes, hosted fixtures or messages to third parties.

## Owner adoption and blockers

1. Review/apply the additive patch on the exact base and rerun under Node 22.23.2.
2. Supply real authoritative expected tenant/source/deployment/config/period/roster
   bindings, source-bound snapshot profile/initial state digest, and authenticate
   all retained evidence outside this pure function. Verify the actual state's
   schema/extensions; unsupported profiles remain blocked, not truncated.
3. Verify the actual authorized ingestion and durable transaction path. No period
   HTTP ingress was verified here. The generic server mutation wrapper increments
   state.version and syncs other state; schema v1 deliberately does not pretend
   that wrapper is a verified period-ingestion contract. If adopted through it,
   inspect the actual persistence/audit changes and revise the strict mutation
   profile with tests. Do not relax unrelated-state checks or fabricate receipts.
4. Implement/verify the owner collector and independent write-journal/readback
   adapters; their actual raw receipt schemas and durable lifecycle identities
   remain unknown. Reconcile to actual evidence rather than teaching collectors
   to manufacture these expected fields or certify themselves.
5. Run authorized invalid/conflict/retry, persistence and consumer proofs under the
   owner's existing isolation/authority. Ingestion currently has no dedicated
   identical-retry receipt: rejection plus zero effects is the inspected contract.
6. Separately satisfy full customer journey, operational readiness, payroll,
   provider, recovery and release gates. This module cannot admit them.

No canonical runtime, readiness, UI, controller, onboarding or payroll source was
edited. There is no second period store, writer, route, receipt authority or runner.
