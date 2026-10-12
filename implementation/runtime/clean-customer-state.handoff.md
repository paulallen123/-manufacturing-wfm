# Clean customer state factory — bounded owner handoff

Additive proposal for paulallen123/-manufacturing-wfm at commit
`8632e5bb5c84e4fc258311d31d973714be169866`, tree
`8f46735489ecfde8ccf38722646df361f532dd02`.

The only proposed repository additions are this handoff,
`implementation/runtime/clean-customer-state.cjs` and its `.test.cjs`.
No existing runtime, provisioner, core, controller, bootstrap, UI or Docker file
was edited. No live tenant/account, credential, provider transaction, push,
merge or deployment was performed. The existing checkout is older than this
base; relevant exact-base files were recovered read-only through the GitHub
connector after direct Git fetch returned proxy HTTP 403. All nine recovered
files were verified against their Git blob hashes. The complete recursive tree
was inspected (not truncated); it contains no AGENTS.md or .agents/skills
instructions. The workspace .agents directory is empty.

## Existing factory inspection

`zero-touch-customer-factory.cjs` orchestrates provisioning/learning/proof jobs;
it does not construct runtime state. `tenant-environment-provisioner.cjs`
persists namespace/configuration metadata. The implementation core validates
cleanup evidence but provides no clean runtime constructor. The pinned
`server.cjs:initTenant` calls `W.seed()` and `E.decorate()`. Neither is suitable
for customer state. No genuine clean constructor was found in these relevant
paths or the pinned runtime. The new constructor does not replace their work.

## Interface and authority boundary

```js
const { createCleanCustomerState } = require('./clean-customer-state.cjs');
const state = createCleanCustomerState({
  tenant,
  owner: { tenant, person_id: verifiedUser.person_id },
  organisation: { tenant, ownerAnchor: {
    id: verifiedUser.person_id, parent: null,
    name: authorisedOwnerDisplayName, label: authorisedOrganisationLabel
    // Optional role is a genuinely supplied org title, never an account role.
  } },
  authority: {
    tenant, person_id: verifiedUser.person_id,
    purpose: 'construct-clean-customer-state', reference: externalAuthorityReference
  }
}, { authorize: trustedSynchronousAuthorityCheck });
```

Every supplied property, including optional role, must be an own enumerable
data property on a plain object. Hidden properties and accessors are rejected
before the authority callback, so structuredClone cannot silently discard a
value that was accepted by validation.

The caller must independently verify the canonical users.person_id, same-tenant
ownership, root-anchor linkage and every supplied organisation fact from
trusted server-side records. The callback receives a deeply frozen snapshot of
the complete input and must return literal `true`; async results fail closed.
Neither callback nor authority reference is a request-controlled approval flag.
The factory validates consistency and shape, not the authenticity of external
records. The authority reference is not persisted as approval evidence.

This bounded interface accepts one explicit authorised root anchor. It does
not infer additional org nodes, titles, sites, jurisdiction, calendars, workforce
membership, payroll identity, account permissions or personnel_links. The owner
is absent from staff and onboarding.people. A title can be omitted. Pinned
orgNode interpolates IDs into HTML attributes, so person_id must use letters,
digits, underscore, dot, colon or hyphen, starting with a letter or digit.
This is a reader compatibility restriction, not a new identity scheme.

Unknown required identity/organisation authority throws. Before those facts are
available, the owner must keep a verified setup principal behind an explicit
setup-only boundary; this factory does not produce an unauthorised placeholder
org or worker. The unchanged organisation renderer throws for a missing anchor.
One persistent customer workspace and the single initial questionnaire remain
owner-controlled lifecycle concerns: construction performs no storage, creates
no questionnaire and does not reset or overwrite an existing tenant.

## Pinned runtime coverage

Archive: `artifact/wfm-0.6.76-hosted-staging-rc1.tar.gz`.
SHA-256: `3ca08429d1b8dc9e9f604f0414865d41ff871c07bdf76f0a1c84541ab7f27f4d`.
Tests hash-check and extract this actual archive; absent/wrong bytes fail.

All 18 public decorators were inspected and run three times, including after
JSON round-trip. Deep comparison confirms no additions or changes to clean
state. The unconditional demo `engine.decorate` is explicitly excluded and
tripped if called, as are `core.seed` and `readiness.seedFixture`.

| Decorators | Risk prevented by explicit shell |
| --- | --- |
| cost-engine | schema 3 suppresses e40/e41, synthetic rates/payroll IDs, budgets, calendar and history; real refreshCostView runs |
| payroll-control | version 1 suppresses fixed demo periods, records and approvals |
| work-rules | existing workRules suppresses demo contracts, shifts, premiums, leave rules/balances and e1/e2 writes |
| demand-engine | existing schema 6 shell suppresses products, synthetic history/forecasts, market references and sharing=true |
| operations-engine | existing shell suppresses the default legal break rule |
| schedule-publication, readiness-engine, onboarding-engine | explicit versioned empty drafts/publications/notices/requirements/runs/people/batches/receipts |
| org-admin | independent baseOrg copy of the authorised anchor; no invented changes or reporting hierarchy |
| time-review, overtime-watch | explicit unknown settings prevent default thresholds from becoming customer policy |
| attendance-corrections, economic-cost-engine, manufacturing-context, manufacturing-scenarios, resources-engine, recommendation-engine, value-cockpit | explicit empty schemas suppress lazy shell creation; no history, workers, costs or outcomes |

The tests execute the actual sealed `load()` source in an isolated VM with real
decorators and an in-memory SQLite database, rather than launching the server
or invoking initTenant. They save with the same UPDATE/JSON format used by
mutate, read twice, and execute actual sanitise with costs false and true.
They exercise E.allowedPeople/W.scopedStaff, cost/work-rules/demand settings,
operations collections, readiness board/runs, schedule dashboard, OA.report,
ON.report and analytics. Actual pinned onboarding people/batches and both org
renderers are evaluated; this is renderer-function coverage, not a browser or
full composed customer application test.

No demo people, schedules, timesheets, pay entries, opening balances,
competencies, invitations, authority receipts or prior outcomes appear. Empty
aggregate numeric totals returned by readers are not imported evidence.

## Narrow integration requirements and blocked readers

These are release blockers, not issues solved by an empty state or namespace.
The owner must keep clean-state/provider adapters disabled until separately
reviewed safe wiring enforces every gate below: policy fallback gates independent
of period existence, cohort/privacy and empty coverage, configured-site first
worker intake, exact identity linkage without truncation, and all synthetic-reader
labels/metadata. Separate owner onboarding, WebAuthn and component-browser proof
does not admit this factory or substitute for that integration review.

1. The owner must wire this constructor into a transactional, authorised new-state
   path before demo initTenant can run. Never pass it through E.decorate or
   substitute W.seed on construction/load errors. Preserve existing persistent
   state and bind every database write to the validated tenant. No wiring is
   included in this patch; the factory returns a runtime body, not a tenant row.
2. Gate unrestricted org rendering until the authorised root anchor is available.
   A missing anchor makes app.js orgNode dereference an absent name. A verified
   email/setup principal alone does not supply org authority. Do not invent
   Operations director/Factory manager/Team leader titles to satisfy readers.
3. P.reviewDashboard requires an existing period (404); time-review.report
   dereferences the last period's id and throws when empty. Render an honest
   no-period/pending-source state before invoking those readers. Time-review
   thresholds are null until genuinely reviewed; no activation is permitted yet.
   This is not sufficient containment once periods/teams are imported:
   time-review.thresholds uses active thresholds || state thresholds || DEFAULT.
   Null therefore falls back to the five-minute defaults when a report has
   records to analyse. Gate time-review until genuine reviewed thresholds exist,
   independently of the no-period gate; null does not disable that reader.
4. Overtime-watch settings validates booleans/numbers and rejects the explicit
   unknown settings. The owner must present pending-policy state and require
   actual reviewed settings before enabling this reader, never adopt defaults
   as customer approval. Some server routes read lateClockMinutes directly;
   gate those routes too while policy remains unknown.
5. ON.normalise validates site by searching s.staff. Therefore the unchanged
   onboarding path rejects the first real worker with 'Site is not configured.'
   Supply an authoritative configured-site validation seam in a separately
   assigned integration change. Do not add a dummy worker. Reviewed contract
   baselines, actual roles/permissions and workforce links also need real inputs.
6. Several successful empty readers contain fixed demo-era metadata/copy:
   E.analytics emits synthetic provenance and London snapshot bounds;
   R.report emits fixed CHECKED/SOURCES and a draft GB rule-pack label;
   C.dashboard returns GBP and totalIsComplete=true for an empty result;
   operations reports contain fixture/sample descriptions. These are reader
   limitations, not factory-supplied customer facts or readiness approvals.
   The owner must gate or qualify them. Hard-coded statutory calendar helpers
   do not constitute a reviewed customer calendar; costing.calendar stays null.
7. Demand benchmarks have independent containment requirements:
   headcount comparisons against minCohort:null coerce that unknown value to
   zero, and the reader computes sharing as shareAggregates || director-role.
   Thus a director overrides the false flag in the returned benchmark view.
   Empty cohorts can report coverage.complete=true through vacuous evaluation.
   Gate benchmarks until reviewed minimum-cohort/privacy settings and meaningful
   population/source coverage exist. Enforce actual sharing authority at the
   caller boundary even for directors; do not interpret null/false or an empty
   complete result as privacy protection, approved sharing or evidence completeness.
8. Canonical person_id may be up to 100 characters in this factory, while
   ON.normalise cleans/truncates manager_id to 64 characters. A 65–100-character
   owner anchor therefore cannot safely traverse that unchanged onboarding
   lookup. The owner must resolve the reader-contract mismatch before enabling
   onboarding for such identities. Do not truncate or rewrite canonical IDs,
   create aliases implicitly, or treat a truncated lookup as the same principal.
9. These tests cover the sealed pinned readers, not every Docker-composed overlay
   or authenticated route. The exact-base Dockerfile and relevant presentation
   patch/sanitisation scripts were inspected read-only, but no Docker build,
   complete application boot, hosted proof or provider validation was run.

## Verification and application

Runtime actually used: Node v24.19.0, Linux x64. Node 22.23.2 is not installed
and no cached Docker image was available; that preferred-runtime check remains
outstanding. Eleven tests pass, zero fail/skip. TAP evidence and hash bindings are
included in the review bundle.

Independent-review P2 correction: before the correction, an otherwise valid
anchor with non-enumerable id/name/parent was accepted and both the authority
snapshot and returned anchor contained only its label. The regression first
failed with a missing expected rejection. The constructor now rejects every
non-enumerable field at all five input-object levels, including optional role.
Tests cover every supplied property, rejection before authorize, exact frozen
authority snapshot/returned-root values with and without role, and isolation
from mutations to the caller's original input during authorisation. No shared
reader was modified to address the separately documented integration gates.

From the exact base repository, after reviewing the additive patch:

```sh
git apply --check clean-customer-state.patch
git apply clean-customer-state.patch
node --test implementation/runtime/clean-customer-state.test.cjs
```

For an archive stored elsewhere, set CLEAN_CUSTOMER_ARCHIVE to its path; the
same required SHA-256 is enforced. No npm packages, network, credentials or
live accounts are needed by the tests (Node with node:sqlite and tar required).
This factory alone establishes neither hosted/customer proof nor a fully
accessible customer workspace, production readiness or approved policies.
