# Vector UX/CX scorecard

This is the single canonical scorecard for the approved Vector role-first NEW-UI lineage. Historical cycle detail remains in Git history; this file keeps only the current evidence boundary, validated increments and one dependency-ordered next action so documentation does not become a second backlog.

## 2026-09-20 — Vector r16: lifecycle-consistent action affordance

### Journey reviewed
Factory/operations manager Vector Home → `Needs my action` / collapsed `Awaiting source confirmation` → Time Review. The review focused on whether source-confirming work still looks like fresh work requiring another manager decision.

### NEW-UI lineage confirmation
All product/test work is on `feature/one-day-enterprise-implementation-v1` / PR #79, the canonical Vector role-first NEW-UI owner. No legacy/0.6.139 presentation, retired UI branch, customer-proof runtime, staging or production presentation was changed.

### Reuse / duplicate-work decision
- Reused the existing `actionDisposition()` / `actionQueueGroups()` lifecycle partition, Universal Action row renderer, source-owned confirmation state, neutral action styling, action-queue regression and exact-candidate browser oracle.
- Did not create another queue, component, lifecycle mapper, branch, issue, prototype or browser harness.
- Did not repeat competitor/generic UX research because the unresolved question was already answered by authoritative lifecycle semantics.
- Did not retry unchanged Railway containment or weaken any proof/runtime security hold.

### Hypothesis
If source-confirming rows remain inspectable but use a passive lifecycle-consistent affordance, managers should distinguish “I need to act” from “the source is confirming my decision” faster without losing evidence, recovery or audit context.

### Exact implementation delta
- Added one shared `actionAffordance(row)` helper to the existing Vector renderer.
- `decision_sent` and `confirming_source` now render **View status**.
- `action_required`, `needs_verification` and neutral/fallback work retain the existing **Review** affordance.
- The same route, source ID, workflow binding, lifecycle text, queue grouping, badge count and neutral visual treatment are preserved.
- The accessible button label now matches the visible affordance (`View status …` or `Review …`).
- Affordance selection is derived only through structured `confirmationState` → `actionDisposition()`; loose presentation words, row order, elapsed client time and AI output cannot select it.

### Focused validation / regression delta
- Extended the existing `ux-overlay/vector-action-queue.test.cjs`; no new test harness was created.
- The regression protects actionable rows as **Review**, source-confirming rows as **View status**, matching accessible labels, resolved exclusion, collapsed confirmation disclosure and presentation-word independence.
- Focused deterministic logic smoke passed: `action_required` / `needs_verification` → Review; `decision_sent` / `confirming_source` → View status; loose “Urgent” wording without authoritative confirmation state → Review.
- Extended the existing `scripts/current-candidate-role-browser-proof.mjs` in commit `d1a4d681447ac75a17a6f33a31bb63259bc2ff19`; no second oracle was created.
- The exact-candidate oracle now asserts at 1440/760/390 that visible `Needs my action` buttons read **Review**, their accessible labels begin `Review …`, source-confirming rows remain **View status**, and after keyboard expansion those awaiting-source buttons are visible with matching `View status …` accessible labels.
- Existing source-ID binding, actionable-only badge semantics, collapsed disclosure, keyboard open/close, responsive containment, lifecycle visibility, no optimistic clear and return-to-context assertions remain in the same oracle.

### Blocker discipline
The previous exact-head Vector-only GitHub job failed before any workflow step executed (`runner_id=0`, `steps=[]`). That was the unchanged hosted-runner allocation blocker rather than a demonstrated source/test failure. It is rechecked only after a meaningful candidate-head change; no repeated retry or production/staging mutation is used to manufacture evidence.

### UX scorecard impact
- Calm by default: improved — confirmation-in-progress no longer reuses a fresh-work verb, while its disclosure stays collapsed.
- Dense on demand: preserved — no new panel, page or permanent information is added.
- Explainability: improved — visible and accessible action wording matches authoritative lifecycle disposition.
- Accessibility: stronger source/browser acceptance criteria now cover keyboard disclosure and matching visible/accessibility affordances; exact hosted execution remains pending.
- Authority/auditability: preserved — no source state, approval authority, SLA, resolution logic or write authority moved into Vector.
- Development efficiency: improved — one generic renderer, one unit-regression owner and one existing exact-candidate browser oracle cover the lifecycle contract without a parallel implementation.

### Still unverified
The exact-current-head browser oracle has not yet executed on a safe runner, so responsive DOM/accessibility behaviour and the full authenticated journey are not hosted-green. A genuine source-owned `Action required → Decision sent → Confirming source` transition also remains to be exercised end-to-end.

### Single next highest-value NEW-UI action
Execute the existing exact-candidate browser oracle on the current r16 head. A green result must prove **Review** versus **View status** at 1440/760/390 alongside source identity, actionable-only badge semantics, keyboard disclosure, no optimistic clear and return-to-context. If green, drive one real authoritative Time Review item through `Action required → Decision sent → Confirming source` and prove it moves sections/affordance without disappearing, changing authority or inflating the bell count before extending the shared pattern to Absence or weekly sign-off.

## 2026-09-20 — Vector r15: remove position-inferred action urgency

### Validated delta
- Removed the positional `.vector-alert-row:first-child>button` red/pink override from `ux-overlay/vector-shell.css`.
- The existing neutral action style remains: `background:#edf3fb; color:#355375`.
- Extended `ux-overlay/vector-action-queue.test.cjs` with a distinct regression requiring positional urgency styling to remain absent while the neutral default remains present.
- No action ordering, lifecycle grouping, status text, source evidence, permissions, authority, audit or workflow logic changed.

### Evidence boundary
Focused source assertions passed. Exact-head browser execution remains pending because the available GitHub job received no runner and the isolated Railway candidate is intentionally source-held. No hosted-green or measured task-time claim is made.

## Validated prior Vector increments

| Increment | Bounded delta | Evidence boundary |
| --- | --- | --- |
| r14 | Separate `Needs my action` from collapsed source-owned `Awaiting source confirmation`; browser oracle extended for 1440/760/390 grouping, badge and keyboard checks | Source/unit/oracle code proven; exact-head browser execution pending |
| r13 | Render authoritative lifecycle visibly in the existing action row | Focused markup and oracle syntax proven; hosted browser execution pending |
| r12 | Preserve normalized hosted proxy protocol in the read-only Time Review evidence bridge | Exact pre-repair 502 isolated; source/test repair committed |
| r11 | Source-bound Time Review return context, focus restoration and no optimistic-clear oracle | Source composition proven; hosted execution exposed the r12 bridge defect |
| r10 | Bind `Items to review` to the read-only Time Review evidence bridge with per-source neutral fallback | Focused consumer harness passed |
| r9 | Add read-only role/tenant-scoped Time Review action-evidence bridge | Bridge/router focused tests passed |
| r8 | Add first fail-closed Time Review producer inside the shared evidence contract | Contract suite passed |
| r7 | Establish shared source-owned freshness/confirmation evidence contract | Focused contract suite passed |
| r6 | Prevent observation timestamps becoming presentation-owned freshness/urgency | Vector-only guard green at that increment |
| r5 | Source-bind review rows and bell count; remove hidden presentation-card counting | Vector-only guard green at that increment |
| r4 | Source-bind identity/site context and approved next-seven-day leave only | Vector-only guard green at that increment |
| r3 | Remove synthetic KPI trends, invented labour-cost target progress and unsupported KPI severity | Vector-only guard green at that increment |
| r2 | Remove text-inferred department risk, invented shift timeline and percentage-like planning widths | Vector-only guard green at that increment |
| r1 | Remove position-derived review urgency; establish neutral review-state governance | Vector-only guard green at that increment |

## Standing release / evidence boundary
- Cycle 10 schedule-publication promotion remains separately gated by exact source-bound hosted proof.
- Vector is the only active NEW-UI presentation owner in this lineage; retired overlays and legacy/0.6.139 presentation remain non-owners.
- No scorecard entry treats source/build guards or deterministic tests as real-user, authenticated-role, accessibility-device or production proof.
- Missing or stale evidence remains neutral; presentation wording, order or styling cannot manufacture urgency, cost, qualification, compliance, authority or confirmation.
